/**
 * scripts/test-doc-locks.ts  —  npm run test:doclocks
 *
 * Approved documents are locked (owner, 9 Oct 2026): restored CNIC sides, the
 * per-side de-duplication, the lock + one-time unlock, a re-upload that waits
 * in the queue with the badge kept, reject keeping the old file, a changed
 * profile photo re-entering photo review, Partner refusal, and the CNIC-number
 * approval message. Pure logic + source scans. No browser/DB/network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  uploadDecision,
  lockView,
  canPick,
  spendSide,
  unlockParts,
  duplicatesToHide,
  sidesToRestore,
  planReviewDecision,
  cnicApprovalProblem,
  CNIC_NUMBER_MISSING,
  LOCKED_ERROR,
  USED_ERROR,
  type DedupeRow,
} from '../lib/docLockCore'
import { tutorWaiting, tutorCardStatuses, type TutorDocFacts } from '../lib/tutorDocQueueCore'
import { parentWaiting, parentVerified } from '../lib/parentDocsCore'
import { tutorDocStatusesFromProfile } from '../lib/tutorDocStatus'
import { tutorVerifiedBadgeOk } from '../lib/badgeRule'
import { roleSatisfies, isReadOnlyRole, SCREEN_ACCESS } from '../lib/adminAccessCore'
import { isReadMethod } from '../lib/requestMethod'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// An approved tutor with everything on record.
const approved: TutorDocFacts = {
  verification_state: 'approved',
  cnic_verified_at: '2026-10-01T10:00:00Z',
  cnic_number: '35202-1234567-1',
  cnic_image_path: 'u/cnic/1-original',
  avatar_url: 'https://x/a.jpg',
  profile_pic_status: 'approved',
  selfie_status: 'approved',
  hasSelfieFile: true,
  video_status: 'approved',
}

const row = (id: string, user: string, kind: string, label: string | null, at: string, status = 'active'): DedupeRow =>
  ({ id, user_id: user, kind, label, created_at: at, status })

// ---------------------------------------------------------------- locked ----

test('a locked document rejects an upload — API decision is 403 with the plain message', () => {
  const d = uploadDecision({ kind: 'cnic', part: 'front', approved: true, partOnRecord: true, unlock: null })
  assert.deepEqual(d, { allow: false, status: 403, error: LOCKED_ERROR })
  assert.match(LOCKED_ERROR, /Approved ✓ Locked\. To change this document, contact support on WhatsApp 0321 5872222\./)
  const s = uploadDecision({ kind: 'selfie', part: 'selfie', approved: true, partOnRecord: true, unlock: null })
  assert.equal(s.allow, false)
})

test('a locked document rejects an upload — UI offers no picker', () => {
  const v = lockView({ part: 'front', approved: true, partOnRecord: true, reviewPending: false, unlock: null })
  assert.equal(v, 'locked')
  assert.equal(canPick(v), false)
  // The shared controls read the lock: CNIC tiles, onboarding sides, selfie steps.
  assert.match(read('components/tutor/CnicCameraField.tsx'), /if \(!canPick\(lockView\)\)/)
  assert.match(read('components/identity/CnicCapture.tsx'), /useDocLocks\(memberUpload\)/)
  assert.match(read('components/tutor/NewOnboardingFlow.tsx'), /if \(!canPick\(view\)\)/)
  assert.match(read('components/tutor/NewOnboardingFlow.tsx'), /canPick\(selfieView\)/)
  assert.match(read('components/tutor/CompleteProfileFlow.tsx'), /canPick\(selfieView\)/)
  assert.match(read('components/tutor/IdentityDocsStatus.tsx'), /canPick\(statuses\.locks\?\.selfie/)
  // No "Request a change" for an approved CNIC — the lock notice instead.
  assert.match(read('components/identity/IdentityCard.tsx'), /approvedLocked \? \(/)
})

test('the upload route and /api/identity enforce the lock on the server', () => {
  const up = read('app/api/documents/upload/route.ts')
  assert.match(up, /decideUpload\(user\.id, kind, labelStr\)/)
  assert.match(up, /status: lockCtx\.decision\.status/)
  const id = read('app/api/identity/route.ts')
  assert.match(id, /if \(cnicLocked\) return NextResponse\.json\(\{ error: LOCKED_ERROR, locked: true \}, \{ status: 403 \}\)/)
  // Members cannot insert/delete CNIC/selfie rows or overwrite their objects directly.
  const m = read('supabase/migrations/158_document_member_writes.sql')
  assert.match(m, /for insert with check \(user_id = auth\.uid\(\) and kind = 'degree'\)/)
  assert.match(m, /not in \('cnic', 'selfie'\)/)
})

test('rejected or never-uploaded documents stay uploadable exactly as today', () => {
  assert.deepEqual(uploadDecision({ kind: 'cnic', part: 'front', approved: false, partOnRecord: true, unlock: null }), { allow: true, mode: 'normal' })
  assert.deepEqual(uploadDecision({ kind: 'selfie', part: 'selfie', approved: false, partOnRecord: false, unlock: null }), { allow: true, mode: 'normal' })
  assert.equal(lockView({ part: 'selfie', approved: false, partOnRecord: false, reviewPending: false, unlock: null }), 'open')
})

// ---------------------------------------------------------------- unlock ----

test('an unlock allows exactly one upload', () => {
  const unlock = { id: 'u1', usedSides: [] as string[] }
  const first = uploadDecision({ kind: 'selfie', part: 'selfie', approved: true, partOnRecord: true, unlock })
  assert.deepEqual(first, { allow: true, mode: 'review', consumeUnlock: true })
  const spent = spendSide(unlock.usedSides, 'selfie', unlockParts('selfie', []))
  assert.equal(spent.spent, true)
  // The unlock is closed once spent → no open unlock → locked again.
  const second = uploadDecision({ kind: 'selfie', part: 'selfie', approved: true, partOnRecord: true, unlock: null })
  assert.equal(second.allow, false)
  // Even if read before closing, the same part twice is refused.
  const again = uploadDecision({ kind: 'selfie', part: 'selfie', approved: true, partOnRecord: true, unlock: { id: 'u1', usedSides: spent.usedSides } })
  assert.deepEqual(again, { allow: false, status: 403, error: USED_ERROR })
  // CNIC: one front and one back, never the same side twice.
  const cnicParts = unlockParts('cnic', ['front', 'back'])
  const f = spendSide([], 'front', cnicParts)
  assert.equal(f.spent, false)
  assert.equal(uploadDecision({ kind: 'cnic', part: 'front', approved: true, partOnRecord: true, unlock: { id: 'u2', usedSides: f.usedSides } }).allow, false)
  assert.equal(uploadDecision({ kind: 'cnic', part: 'back', approved: true, partOnRecord: true, unlock: { id: 'u2', usedSides: f.usedSides } }).allow, true)
  assert.equal(spendSide(f.usedSides, 'back', cnicParts).spent, true)
})

test('the Partner (view-only) cannot unlock; owner, admin and operations can', () => {
  assert.equal(roleSatisfies('admin', SCREEN_ACCESS.documentUnlock), true)
  assert.equal(roleSatisfies('operations', SCREEN_ACCESS.documentUnlock), true)
  assert.equal(roleSatisfies('owner', SCREEN_ACCESS.documentUnlock), true)
  assert.equal(roleSatisfies('tuitions_staff', SCREEN_ACCESS.documentUnlock), false)
  // A Partner passes screen checks but every POST is refused (checkAdminRole).
  assert.equal(isReadOnlyRole('partner'), true)
  assert.equal(isReadMethod('POST'), false)
  const route = read('app/api/admin/documents/unlock/route.ts')
  assert.match(route, /export async function POST/)
  assert.match(route, /checkAdminRole\(\.\.\.SCREEN_ACCESS\.documentUnlock\)/)
  assert.doesNotMatch(route, /export async function GET/)
  assert.match(read('components/admin/UnlockDocButton.tsx'), /if \(!canUnlock \|\| readOnly\) return null/)
  // Audited with who and when.
  assert.match(read('lib/docLocks.ts'), /action: 'document\.unlock'/)
})

// -------------------------------------------------------- re-upload/queue ----

test('a re-upload after unlock enters the queue, and the Verified badge stays', () => {
  const facts = { ...approved, hasCnicReview: true }
  assert.deepEqual(tutorWaiting(approved), [])
  assert.deepEqual(tutorWaiting(facts), ['CNIC'])
  assert.equal(tutorCardStatuses(facts).cnic.rereview, true)
  // The badge reads the profile approval, which the re-upload does not touch.
  const docs = tutorDocStatusesFromProfile(approved, true)
  assert.equal(tutorVerifiedBadgeOk(true, docs), true)
  // The upload route stores it as 'review' and skips the approval writes.
  const up = read('app/api/documents/upload/route.ts')
  assert.match(up, /status: review \? 'review' : 'active'/)
  assert.match(up, /if \(kind === 'cnic' && !review\)/)
  // Selfie re-upload too.
  assert.deepEqual(tutorWaiting({ ...approved, hasSelfieReview: true }), ['Selfie'])
  // A parent's re-upload: queued, still verified.
  const parent = {
    verification_state: 'approved', cnic_verified_at: '2026-10-01', address: 'House 1', address_status: 'approved',
    address_verified_at: '2026-10-01', hasCnicFront: true, hasCnicBack: true, hasCnicReview: true,
  }
  assert.deepEqual(parentWaiting(parent), ['CNIC'])
  assert.equal(parentVerified(parent), true)
})

test('approving the re-upload puts the new file on record; reject keeps the old one', () => {
  const active = [
    { id: 'oldF', kind: 'cnic', label: 'front', created_at: '2026-09-01' },
    { id: 'oldB', kind: 'cnic', label: 'back', created_at: '2026-09-01' },
  ]
  const waiting = [{ id: 'newF', kind: 'cnic', label: 'front', created_at: '2026-10-09' }]
  const ok = planReviewDecision(active, waiting, 'approve')
  assert.deepEqual(ok.activate, ['newF'])
  assert.deepEqual(ok.hide, ['oldF']) // the back stays on record, untouched
  const no = planReviewDecision(active, waiting, 'reject')
  assert.deepEqual(no.activate, [])
  assert.deepEqual(no.hide, ['newF']) // hidden for history, never deleted
  // The reject path never touches the approval columns.
  const td = read('lib/tutorDocuments.ts')
  const rej = td.slice(td.indexOf('await rejectReview(tutorId, item)'), td.indexOf('const { error } = await admin.from(\'profiles\').update(patch).eq(\'id\', tutorId)\n  if (error) return { ok: false, status: 400, error: error.message }\n  if (item !== \'profile_pic\') await closeOpenUnlocks'))
  assert.doesNotMatch(rej, /cnic_verified_at|selfie_status|verification_state/)
  // Nothing in the lock module deletes a document.
  assert.doesNotMatch(read('lib/docLocks.ts'), /\.delete\(\)/)
})

test('a profile photo change after approval enters the queue; the badge stays', () => {
  const changed = { ...approved, profile_pic_rereview_at: '2026-10-09T09:00:00Z' }
  assert.deepEqual(tutorWaiting(changed), ['Photo'])
  assert.equal(tutorCardStatuses(changed).profilePic.rereview, true)
  // profile_pic_status stays 'approved', so badge (and index) facts are unchanged.
  assert.equal(tutorVerifiedBadgeOk(true, tutorDocStatusesFromProfile(changed, true)), true)
  // The DB stamps it on any member-side photo change; the photo is not locked.
  const m157 = read('supabase/migrations/157_document_locks.sql')
  assert.match(m157, /new\.profile_pic_rereview_at := now\(\)/)
  assert.match(read('supabase/migrations/158_document_member_writes.sql'), /lock_tutor_profile_fields/)
  assert.doesNotMatch(read('app/(site)/tutor/dashboard/settings/page.tsx'), /profilePicStatus === 'completed' \? \(/)
})

// ------------------------------------------------------- restore / dedupe ----

test('the restore is safe to run twice', () => {
  const rows = [
    row('b1', 'u', 'cnic', 'back', '2026-10-02'),
    row('f1', 'u', 'cnic', 'front', '2026-10-01', 'paused'),
    row('f0', 'u', 'cnic', null, '2026-09-30', 'paused'),
  ]
  const first = sidesToRestore(rows)
  assert.deepEqual(first, ['f1']) // newest hidden front only
  const after = rows.map((r) => (first.includes(r.id) ? { ...r, status: 'active' } : r))
  assert.deepEqual(sidesToRestore(after), [])
  // A side that already has a visible upload is never restored.
  assert.deepEqual(sidesToRestore([row('f', 'u', 'cnic', 'front', '2026-10-01'), row('g', 'u', 'cnic', 'front', '2026-10-02', 'paused')]), [])
})

test('de-duplication keeps the newest upload per side, not per member', () => {
  const rows = [
    row('f-old', 'u', 'cnic', 'front', '2026-09-01'),
    row('f-new', 'u', 'cnic', null, '2026-09-02'),
    row('b-new', 'u', 'cnic', 'back', '2026-09-03'),
    row('s1', 'u', 'selfie', null, '2026-09-01'),
    row('s2', 'u', 'selfie', null, '2026-09-04'),
    row('d1', 'u', 'degree', 'BSc', '2026-09-01'),
    row('d2', 'u', 'degree', 'MSc', '2026-09-05'),
  ]
  assert.deepEqual(duplicatesToHide(rows).sort(), ['f-old', 's1'])
  const sql = read('scripts/dataop-pause-dup-documents.sql')
  assert.match(sql, /case when d2\.label = 'back' then 'back' else 'front' end/)
  assert.match(sql, /d\.kind in \('cnic', 'selfie'\)/)
})

// -------------------------------------------------------- CNIC number ----

test('approving a CNIC with no number names the CNIC number box', () => {
  assert.equal(
    cnicApprovalProblem({ number: null, imagePath: 'u/x' }),
    'CNIC number not entered. Type the 13-digit number in the CNIC number box on this page, then approve.',
  )
  assert.equal(cnicApprovalProblem({ number: '35202-1234567-1', imagePath: 'u/x' }), null)
  assert.match(cnicApprovalProblem({ number: '35202-1234567-1', imagePath: null }) ?? '', /No CNIC photo/)
  assert.match(read('components/admin/TutorDocumentReview.tsx'), /data\?\.error === CNIC_NUMBER_MISSING/)
  assert.equal(typeof CNIC_NUMBER_MISSING, 'string')
  // Saved in one step from the review card, any dash style, stored one way.
  const box = read('components/admin/AdminCnicNumberBox.tsx')
  assert.match(box, /action: 'set-cnic-number'/)
  assert.match(box, /must be 13 digits/)
  assert.match(read('app/api/admin/tutors/edit/route.ts'), /const formatted = formatCnic\(raw\)/)
})
