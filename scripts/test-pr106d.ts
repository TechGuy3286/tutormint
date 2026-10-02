/**
 * scripts/test-pr106d.ts  —  npm run test:pr106d
 *
 * PR106-D: CNIC split, badges-after-name placement, the badge pop-up states,
 * the fee card removed, the quota counter on the My-applications tile, and the
 * payment screens' Back / Pay later / manual option. Pure logic (cnicStepView,
 * quotaCounter, verificationFeeCardState) + source scans; no DB.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { cnicStepView } from '../lib/cnicStep'
import { quotaCounter, verificationFeeCardState } from '../lib/tutorDashboard'
import { FLOW_ORDER, stepDone } from '../lib/tutorFlow'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// ---------------------------------------------- CNIC split (§1.2) --------------

test('the CNIC step is split into number + photos, in order, before the fee', () => {
  const iN = FLOW_ORDER.indexOf('cnic_number')
  const iP = FLOW_ORDER.indexOf('cnic_photos')
  const iV = FLOW_ORDER.indexOf('verify')
  assert.ok(iN >= 0 && iP === iN + 1 && iV === iP + 1, 'number → photos → verify')
  assert.ok(!(FLOW_ORDER as string[]).includes('cnic'), 'the combined cnic step is gone')
})

test('each CNIC screen is done by its own half; prefill/lock use the shared view', () => {
  assert.equal(stepDone({ cnicNumber: '1' } as never, 'cnic_number'), true)
  assert.equal(stepDone({ cnicNumber: null } as never, 'cnic_number'), false)
  assert.equal(stepDone({ cnicImagePath: null } as never, 'cnic_photos'), false)
  assert.equal(stepDone({ cnicImagePath: 'p/x' } as never, 'cnic_photos'), true)
  // Lock after approval needs number + both photos; prefill with a missing side
  // stays "capture" so the saved parts show.
  assert.equal(cnicStepView({ state: 'approved', hasNumber: true, hasFront: true, hasBack: true }), 'approved')
  assert.equal(cnicStepView({ state: 'none', hasNumber: true, hasFront: true, hasBack: false }), 'capture')
})

test('both CNIC screens have their own heading, and the shared CnicCapture supports number-only / photos-only', () => {
  const flow = read('components/tutor/CompleteProfileFlow.tsx')
  assert.ok(flow.includes("cnic_number: 'Your CNIC number'"), 'number screen heading')
  assert.ok(flow.includes("cnic_photos: 'Photos of your CNIC'"), 'photos screen heading')
  assert.ok(flow.includes('CnicNumberStep') && flow.includes('CnicPhotosStep'))
  const cap = read('components/identity/CnicCapture.tsx')
  assert.ok(cap.includes("show?: 'all' | 'number' | 'photos'"), 'CnicCapture takes a show mode')
})

// ---------------------------------------------- fixed footer (§1.1) ------------

test('the onboarding primary buttons are sticky to the bottom with safe-area', () => {
  const flow = read('components/tutor/CompleteProfileFlow.tsx')
  assert.ok(flow.includes('sticky bottom-[calc(0.75rem_+_env(safe-area-inset-bottom))]'), 'sticky + safe-area')
})

// ---------------------------------------------- badges after name (§2/§3) ------

test('every name+badge surface puts the badges right after the name', () => {
  // The dashboard header uses the tappable VerifyBadgeControl on the name line.
  const header = read('components/tutor/TutorHeaderCard.tsx')
  assert.ok(header.includes('VerifyBadgeControl'), 'dashboard header uses the verify control')
  assert.ok(!header.includes('NotVerifiedBadge'), 'the old separate not-verified badge row is gone from the header')
  // Surfaces that moved badges onto the name line carry the PR106-D §3 marker.
  for (const f of [
    'components/TutorCard.tsx',
    'app/(site)/tutor/[slug]/page.tsx',
    'app/(site)/parent/dashboard/job/[jobId]/ApplicantList.tsx',
    'app/(site)/parent/[id]/page.tsx',
    'components/messages/InboxShell.tsx',
    'app/(site)/tuitions/[city]/[slug]/page.tsx',
  ]) {
    assert.ok(read(f).includes('PR106-D §3'), `${f} marks the name-line badge placement`)
  }
})

// ---------------------------------------------- pop-up states (§3/§5-7) --------

test('the badge pop-up shows the right benefit ticks per state', () => {
  assert.deepEqual(verificationFeeCardState({ feePaid: false, verifiedOk: false, findable: false }).lines.map((l) => l.done), [false, false, false])
  assert.deepEqual(verificationFeeCardState({ feePaid: true, verifiedOk: false, findable: false }).lines.map((l) => [l.key, l.done]), [['badge', false], ['google', false], ['basic', true]])
  assert.deepEqual(verificationFeeCardState({ feePaid: true, verifiedOk: true, findable: true }).lines.map((l) => l.done), [true, true, true])
  const ctl = read('components/tutor/VerifyBadgeControl.tsx')
  assert.ok(ctl.includes('Get verified') && ctl.includes('Verification pending') && ctl.includes('Pay verification fee'))
  assert.ok(!/Rs\.?\s*199|₨\s*199/.test(ctl), 'no amount in the pop-up')
})

// ---------------------------------------------- fee card removed (§8) ----------

test('the "Your verification fee" dashboard card is removed', () => {
  assert.ok(!existsSync(join(ROOT, 'components/tutor/VerificationFeeCard.tsx')), 'the fee card component is gone')
  assert.ok(!read('app/(site)/tutor/dashboard/page.tsx').includes('VerificationFeeCard'))
})

// ---------------------------------------------- quota on the tile (§9) ---------

test('the applications quota counter: Basic/Premium show the number, Featured never does', () => {
  assert.equal(quotaCounter({ plan: 'basic', used: 0, quota: 10 }).text, '0 of 10 used this month')
  assert.equal(quotaCounter({ plan: 'premium', used: 42, quota: 100 }).unlimited, false)
  assert.equal(quotaCounter({ plan: 'featured', used: 299, quota: 300 }).text, 'Unlimited')
  assert.equal(quotaCounter({ plan: 'featured', used: 299, quota: 300 }).showGetMore, false)
  const dash = read('app/(site)/tutor/dashboard/page.tsx')
  assert.ok(dash.includes('quotaCounter') && dash.includes("label: 'My applications', note:"))
})

// ---------------------------------------------- payment screens (§10/§11) ------

test('the payment screens have Back / Pay later and a manual option', () => {
  const manual = read('app/(site)/pay/manual/[ref]/OrderPageNav.tsx')
  assert.ok(manual.includes('Back') && manual.includes('Pay later'), 'the order page has Back + Pay later')
  const gate = read('components/upgrade/TutorVerifyGate.tsx')
  assert.ok(gate.includes('Pay by bank transfer'), 'the fee screen offers the manual option')
  assert.ok(gate.includes('Bank transfer is activated after our team checks your payment'), 'the plain manual line (EN)')
})
