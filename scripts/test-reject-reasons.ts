/**
 * scripts/test-reject-reasons.ts  —  npm run test:rejectreasons
 *
 * Quick rejection reasons on the Owner's approval screens (owner, Part F,
 * 16 Oct 2026): the seven reasons verbatim, the fallback, a chip + free text,
 * and that the in-app notice, the email and the WhatsApp re-upload text all
 * carry the reason. Pure logic + source scans. No browser/DB/network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  REJECT_REASONS,
  REJECT_FALLBACK,
  reasonsFor,
  buildRejectReason,
  finalRejectReason,
  rejectionNoticeBody,
  rejectionWhatsAppText,
} from '../lib/rejectReasonsCore'
import { render } from '../lib/notify/templates'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const SEVEN = [
  'Selfie not clear — retake in good light',
  'Profile photo must show your face clearly',
  'CNIC back side missing',
  'CNIC photo blurry — retake',
  'CNIC details not readable',
  'Wrong document uploaded',
  "Photo and selfie don't match",
]

test('the seven reasons exist verbatim, and the old fallback is not one of them', () => {
  assert.deepEqual(REJECT_REASONS.map((r) => r.text), SEVEN)
  assert.equal(REJECT_FALLBACK, 'This is not the right document.')
  assert.ok(!SEVEN.includes(REJECT_FALLBACK))
})

test('each item sees its own reasons first, and all seven are offered', () => {
  for (const t of ['cnic', 'selfie', 'photo', 'document'] as const) {
    const list = reasonsFor(t)
    assert.equal(list.length, 7, t)
    assert.deepEqual([...list].sort(), [...SEVEN].sort(), t)
  }
  assert.deepEqual(reasonsFor('cnic').slice(0, 4), [
    'CNIC back side missing',
    'CNIC photo blurry — retake',
    'CNIC details not readable',
    'Wrong document uploaded',
  ])
  assert.equal(reasonsFor('selfie')[0], 'Selfie not clear — retake in good light')
  assert.equal(reasonsFor('photo')[0], 'Profile photo must show your face clearly')
  assert.equal(reasonsFor('document')[0], 'Wrong document uploaded')
})

test('fallback when nothing is chosen or typed', () => {
  assert.equal(buildRejectReason(null, ''), REJECT_FALLBACK)
  assert.equal(buildRejectReason(undefined, '   '), REJECT_FALLBACK)
  assert.equal(finalRejectReason(null), REJECT_FALLBACK)
  assert.equal(finalRejectReason(''), REJECT_FALLBACK)
})

test('a chip alone, free text alone, and chip + free text', () => {
  assert.equal(buildRejectReason('CNIC back side missing', ''), 'CNIC back side missing.')
  assert.equal(buildRejectReason(null, 'Please send it again'), 'Please send it again.')
  assert.equal(
    buildRejectReason('CNIC back side missing', 'Please send both sides!'),
    'CNIC back side missing. Please send both sides!',
  )
  // the server never doubles a full stop already there
  assert.equal(finalRejectReason('CNIC back side missing.'), 'CNIC back side missing.')
})

test('the in-app notice carries the reason', () => {
  const body = rejectionNoticeBody('selfie', 'Selfie not clear — retake in good light', 'Please upload a clear one here.')
  assert.equal(body, 'Your selfie was not approved: Selfie not clear — retake in good light. Please upload a clear one here.')
  assert.match(rejectionNoticeBody('CNIC photo', '', 'Please upload a clear one here.'), /This is not the right document\./)
})

test('the email carries the reason (tutor and parent)', () => {
  const reason = buildRejectReason('Profile photo must show your face clearly', null)
  const tutor = render({ id: 'verification_rejected', name: '', what: 'profile picture', reason, href: '/tutor/dashboard/settings#identity' })
  assert.ok(tutor.text.includes(reason), 'tutor email text')
  assert.ok(tutor.html.includes('Profile photo must show your face clearly'), 'tutor email html')
  const parent = render({ id: 'verification_rejected', name: 'Sara', what: 'CNIC', reason: 'CNIC details not readable.', href: '/parent/verify', audience: 'parent' })
  assert.ok(parent.text.includes('CNIC details not readable.'))
})

test('the WhatsApp re-upload message carries the reason, keeps the Urdu line, never a CNIC number', () => {
  const t = rejectionWhatsAppText({ what: 'CNIC photo', reason: 'CNIC photo blurry — retake', link: 'https://www.tutormint.org/tutor/dashboard/settings#identity', audience: 'tutor' })
  assert.match(t, /^Hi, your CNIC photo on TutorMint was not approved: CNIC photo blurry — retake\. Please upload a clear one here: https:/)
  assert.match(t, /السلام علیکم، آپ کی CNIC photo منظور نہیں ہوئی: CNIC photo blurry — retake\. براہِ کرم واضح تصویر یہاں اپلوڈ کریں:/)
  const p = rejectionWhatsAppText({ what: 'CNIC photo', reason: '', link: 'https://x/parent/verify', audience: 'parent' })
  assert.match(p, /not approved: This is not the right document\. Please correct it here:/)
  assert.ok(!/\d{5}-\d{7}-\d/.test(t))
})

test('wiring: both review cards use the shared picker and builders; servers use the fallback', () => {
  const tutorUi = read('components/admin/TutorDocumentReview.tsx')
  assert.match(tutorUi, /<RejectReasonPicker/)
  assert.match(tutorUi, /rejectionWhatsAppText\(/)
  assert.match(tutorUi, /buildRejectReason\(chosen, note\)/)
  const parentUi = read('components/admin/ParentDocumentReview.tsx')
  assert.match(parentUi, /<RejectReasonPicker/)
  assert.match(parentUi, /rejectionWhatsAppText\(/)
  const picker = read('components/admin/RejectReasonPicker.tsx')
  assert.match(picker, /onChoose\(on \? null : r\)/, 'tap again clears the chip')
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(picker), 'no raw hex')
  const tutorLib = read('lib/tutorDocuments.ts')
  assert.match(tutorLib, /finalRejectReason\(params\.reason\)/)
  assert.match(tutorLib, /rejectionNoticeBody\(/)
  assert.match(tutorLib, /id: 'verification_rejected'[^]*reason: reason\.trim\(\)/)
  const parentLib = read('lib/parentDocuments.ts')
  assert.match(parentLib, /finalRejectReason\(params\.reason\)/)
  assert.match(parentLib, /rejectionNoticeBody\(/)
  // Approvals stay Owner-only — the route guard is untouched.
  assert.match(read('app/api/admin/tutors/document-review/route.ts'), /refuseUnlessOwnerApproval\(/)
  assert.match(read('app/api/admin/parents/document-review/route.ts'), /refuseUnlessOwnerApproval\(/)
})
