/**
 * scripts/test-reviewer-cnic.ts — owner, 16 Nov 2026. Invented data only;
 * nothing here reads or writes the database.
 *
 *   1. CNIC number Show/Hide for document reviewers (Owner, Project Manager,
 *      Backend Support): each Show is logged before the number is returned;
 *      every other role is refused and nothing is read.
 *   2. "Not interested" on every People card (every stage and chip but Paid)
 *      and on the member page.
 *   3. Dark / blank CNIC images: refused in the browser with the CNIC message,
 *      flagged on the server, a normal picture passes, and nothing is ever
 *      rejected automatically.
 *
 *   npm run test:reviewercnic
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { revealCnic, mayRevealCnic, CNIC_REVEAL_ROLES, CNIC_REVEAL_REFUSED } from '../lib/cnicRevealCore'
import { niMenuAllowed, niMemberPageAllowed } from '../lib/notInterestedCore'
import {
  BLANK_SIZE,
  CNIC_TOO_DARK,
  blankFlagText,
  blankRejectReason,
  currentBlankItems,
  flaggedRefs,
  greyStats,
  looksBlank,
  pixelsLookBlank,
} from '../lib/photoBlankCore'
import { blankLine } from '../lib/tutorPipelineCardCore'
import { REJECT_REASONS } from '../lib/rejectReasonsCore'
import { AdminReadOnlyProvider } from '../components/admin/ReadOnly'
import CnicShow from '../components/admin/CnicShow'
import { PipelineMoreMenu } from '../components/admin/PipelineActions'

const read = (p: string) => readFileSync(p, 'utf8')
/** Render inside the admin flags provider. */
const inAdmin = (child: ReturnType<typeof createElement>, cnicReveal = false) =>
  renderToStaticMarkup(createElement(AdminReadOnlyProvider, { readOnly: false, cnicReveal, children: child }))
const FAKE_CNIC = '42101-1234567-1' // the documented example number, never a member's
const MEMBER = '00000000-0000-4000-8000-000000000001'

// ------------------------------------------------------------ 1. CNIC Show --

test('reviewers (Owner, Project Manager, Backend Support) get the full number, logged first', async () => {
  assert.deepEqual([...CNIC_REVEAL_ROLES].sort(), ['backend_support', 'owner', 'partner'])
  for (const role of ['owner', 'partner', 'backend_support']) {
    const order: string[] = []
    const r = await revealCnic({ adminRole: role }, MEMBER, {
      loadNumber: async () => {
        order.push('load')
        return '4210112345671'
      },
      log: async ({ memberId }) => {
        order.push(`log:${memberId}`)
      },
    })
    assert.equal(r.status, 200, role)
    assert.deepEqual(r.body, { cnicNumber: FAKE_CNIC })
    assert.deepEqual(order, ['load', `log:${MEMBER}`], `${role}: every Show is logged before the number is returned`)
  }
})

test('every other role keeps the masked number: refused, nothing read, nothing logged', async () => {
  for (const role of ['admin', 'operations', 'tuitions_staff', 'supervisor', null, undefined, '']) {
    let touched = 0
    const r = await revealCnic({ adminRole: role }, MEMBER, {
      loadNumber: async () => {
        touched++
        return '4210112345671'
      },
      log: async () => {
        touched++
      },
    })
    assert.equal(r.status, 403, String(role))
    assert.deepEqual(r.body, { error: CNIC_REVEAL_REFUSED })
    assert.equal(touched, 0)
    assert.equal(mayRevealCnic(role), false)
  }
})

test('the Show button renders for reviewers only (member page and review card share CnicShow)', () => {
  const render = (cnicReveal: boolean) => inAdmin(createElement(CnicShow, { memberId: MEMBER, masked: 'XXXXX-XXXXXXX-1' }), cnicReveal)
  assert.match(render(true), />Show</)
  assert.doesNotMatch(render(false), />Show</)
  assert.match(render(false), /XXXXX-XXXXXXX-1/)
  // The layout sets the flag from the same rule; the route admits reviewers and logs.
  assert.match(read('app/admin/layout.tsx'), /cnicReveal=\{mayRevealCnic\(actor\.adminRole\)\}/)
  const route = read('app/api/admin/tutors/cnic-reveal/route.ts')
  assert.match(route, /checkAdminRole\('admin', 'partner', 'backend_support'\)/)
  assert.match(route, /action: 'cnic\.reveal'/)
  // Both review cards use the shared button.
  assert.match(read('components/admin/AdminCnicNumberBox.tsx'), /<CnicShow memberId=\{tutorId\}/)
  assert.match(read('components/admin/ParentDocumentReview.tsx'), /<CnicShow memberId=\{docs\.parentId\}/)
})

// ---------------------------------------------------- 2. Not interested --

test('"Not interested" is on cards in every stage and chip except Paid', () => {
  const stages = ['missing', 'waiting', 'rejected', 'approved'] as const
  const chips = [{}, { reuploaded: true }, { triedToPay: true }, { section: 'not' }, { section: 'done' }]
  const fus = ['not', 'f1', 'f2', 'f3']
  for (const stage of stages) {
    for (const chip of chips) {
      for (const fu of fus) {
        const pipe = { stage, notInterested: false, follow: null, ...chip, fu } as never
        const html = inAdmin(createElement(PipelineMoreMenu, { memberId: MEMBER, pipe }))
        assert.match(html, /aria-label="More actions"/, `${stage} / ${JSON.stringify(chip)} / ${fu}`)
      }
    }
    assert.equal(niMenuAllowed(stage), true)
  }
  // Paid: hidden (someone who paid is not "not interested") — unless already marked, so Undo stays.
  assert.equal(niMenuAllowed('paid'), false)
  assert.equal(niMenuAllowed('paid', true), true)
  const paid = inAdmin(createElement(PipelineMoreMenu, { memberId: MEMBER, pipe: { stage: 'paid', notInterested: false } as never }))
  assert.equal(paid, '')
  // The card behaves the same everywhere: one button, one route, the instant move.
  const btn = read('components/admin/NotInterestedButton.tsx')
  assert.match(btn, /move\.begin\(memberId, notInterestedLeaves\(move\.view\)\)/)
  assert.match(btn, /\/api\/admin\/follow-ups\/not-interested/)
})

test('"Not interested" is on the member page too', () => {
  assert.equal(niMemberPageAllowed({ role: 'tutor', feePaid: false, marked: false }), true)
  assert.equal(niMemberPageAllowed({ role: 'tutor', feePaid: true, marked: false }), false)
  assert.equal(niMemberPageAllowed({ role: 'tutor', feePaid: true, marked: true }), true)
  assert.equal(niMemberPageAllowed({ role: 'parent', feePaid: false, marked: false }), true)
  assert.equal(niMemberPageAllowed({ role: 'admin', feePaid: false, marked: false }), false)
  const page = read('app/admin/users/[id]/page.tsx')
  assert.match(page, /niMemberPageAllowed\(/)
  assert.match(page, /<NotInterestedButton memberId=\{id\} marked=\{!!niMark\} \/>/)
})

// ------------------------------------------------------ 3. Dark CNIC images --

const rgba = (fill: (i: number) => number) => {
  const n = BLANK_SIZE * BLANK_SIZE
  const out = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const v = fill(i)
    out[i * 4] = v
    out[i * 4 + 1] = v
    out[i * 4 + 2] = v
    out[i * 4 + 3] = 255
  }
  return out
}

test('a dark CNIC image is blocked in the browser; a normal one passes', () => {
  // The browser applies the server's rule to the drawn picture.
  assert.equal(pixelsLookBlank(rgba(() => 8)), true, 'almost black')
  assert.equal(pixelsLookBlank(rgba((i) => (i % 7) * 4)), true, 'dark noise')
  // A card: light background with dark text rows — plenty of detail.
  assert.equal(pixelsLookBlank(rgba((i) => (Math.floor(i / BLANK_SIZE) % 6 === 0 ? 40 : 210))), false)
  assert.equal(CNIC_TOO_DARK, 'CNIC photo is too dark. Please retake it in good light, with the whole card visible.')
  const brightness = read('lib/photoBrightness.ts')
  assert.match(brightness, /export async function cnicPhotoProblem/)
  // Both CNIC upload paths run it before anything is sent.
  for (const f of ['components/tutor/CnicCameraField.tsx', 'components/tutor/NewOnboardingFlow.tsx']) {
    const src = read(f)
    const at = src.indexOf('await cnicPhotoProblem(img)')
    assert.ok(at > 0, `${f} checks the CNIC photo`)
    assert.ok(at < src.indexOf("append('kind', 'cnic')"), `${f}: the check runs before the upload`)
    assert.match(src, /if \(dark\) throw new Error\(dark\)/)
  }
})

test('the server measures a dark CNIC file as blank and a normal one as fine (sharp, same thresholds)', async () => {
  const measure = async (buf: Buffer) => {
    const grey = await sharp(buf).rotate().resize(BLANK_SIZE, BLANK_SIZE, { fit: 'fill' }).grayscale().raw().toBuffer()
    return looksBlank(greyStats(new Uint8Array(grey)))
  }
  const dark = await sharp({ create: { width: 800, height: 500, channels: 3, background: { r: 6, g: 6, b: 8 } } }).jpeg().toBuffer()
  const stripes = Buffer.alloc(800 * 500 * 3)
  for (let y = 0; y < 500; y++) for (let x = 0; x < 800; x++) stripes.fill(y % 40 < 6 ? 30 : 220, (y * 800 + x) * 3, (y * 800 + x) * 3 + 3)
  const card = await sharp(stripes, { raw: { width: 800, height: 500, channels: 3 } }).jpeg().toBuffer()
  assert.equal(await measure(dark), true)
  assert.equal(await measure(card), false)
})

test('a flagged CNIC shows on the card and in Review, with Reject — photo unclear and Looks fine', () => {
  const refs = flaggedRefs([
    { item: 'cnic', ref: 'doc-front', blank: true },
    { item: 'cnic', ref: 'doc-back', blank: true, cleared_at: '2026-11-16T00:00:00Z' },
    { item: 'photo', ref: 'p1', blank: false },
  ])
  assert.deepEqual([...refs.cnic], ['doc-front'], 'a cleared ("Looks fine") file is not flagged')
  assert.deepEqual(currentBlankItems({ photoRefs: [], selfieRefs: [], cnicRefs: ['doc-front'] }, refs), ['cnic'])
  assert.deepEqual(currentBlankItems({ photoRefs: [], selfieRefs: [], cnicRefs: ['doc-other'] }, refs), [])
  assert.equal(blankLine({ blank: ['cnic'] }), 'CNIC image looks blank')
  assert.equal(blankLine({ blank: ['photo', 'cnic'] }), 'Photo looks blank: Profile photo · CNIC image looks blank')
  assert.equal(blankLine({ blank: ['photo', 'selfie'] }), 'Photo looks blank: Profile photo, Selfie')
  assert.equal(blankFlagText('cnic'), 'CNIC image looks blank')
  // The reject reason is an existing CNIC quick reason.
  const reason = blankRejectReason('cnic')
  assert.ok(REJECT_REASONS.some((r) => r.text === reason && r.appliesTo.includes('cnic')))
  assert.match(read('components/admin/TutorDocumentReview.tsx'), /blank=\{blankItems\.includes\('cnic'\)\}/)
  assert.match(read('app/api/admin/photos/looks-fine/route.ts'), /z\.enum\(\['photo', 'selfie', 'cnic'\]\)/)
  // Counted in Overview "Blank photos to check" (the same flags map).
  assert.match(read('lib/overviewItems.ts'), /case 'todo-blank-photos'[\s\S]*?blankPhotoFlags\(null\)/)
})

test('a dark CNIC is only ever flagged — nothing is rejected automatically', () => {
  const io = read('lib/photoBlank.ts')
  // The check's only writes are to photo_blank_checks.
  const writes = [...io.matchAll(/\.from\('([a-z_]+)'\)\s*\.(update|upsert|insert|delete)\(/g)].map((m) => m[1])
  assert.ok(writes.length > 0)
  for (const t of writes) assert.equal(t, 'photo_blank_checks')
  assert.doesNotMatch(io, /verification_state:\s*'rejected'|reviewTutorDocument|document-review/)
  // Already-approved CNICs stay flagged (for the Owner to recheck): only a rejected CNIC is skipped.
  assert.match(io, /rejectedCnic\.has\(k\) && s\.status !== 'review'/)
  // Both upload routes run the check after a CNIC upload.
  assert.match(read('app/api/documents/upload/route.ts'), /if \(kind === 'cnic'\) after\(\(\) => checkPhotosAfterUpload\(user\.id\)\)/)
  assert.match(read('app/api/admin/tutors/media/route.ts'), /after\(\(\) => checkPhotosAfterUpload\(tutorId\)\)/)
  // The database allows the new item (migration 232).
  assert.match(read('supabase/migrations/232_blank_check_cnic.sql'), /check \(item in \('photo', 'selfie', 'cnic'\)\)/)
})
