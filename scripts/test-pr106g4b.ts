/**
 * scripts/test-pr106g4b.ts  —  npm run test:pr106g4b
 *
 * PR106-G4b: the ONE final "Complete Your Verification" screen (straight to
 * PayPro, English-only, full progress), the value-first dashboard card, and
 * hiding bank transfer + "Pay later" for owner/staff on every payment surface —
 * all behind the Staff-only switch, non-staff unchanged. Source scans + the
 * pure switch. No browser, no DB, no network, no real payment.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { showNewOnboarding } from '../lib/onboardingMode'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const FLOW = read('components/tutor/NewOnboardingFlow.tsx')
const URDU = /[؀-ۿ]/ // any Arabic-script (Urdu) character

/** The body of a named top-level function, up to the next `\nfunction `. */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}`)
  assert.ok(start >= 0, `${name} exists`)
  const after = src.indexOf('\nfunction ', start + 1)
  return src.slice(start, after === -1 ? undefined : after)
}

// --------------------------------------------- STEP 1: the final screen -----
test('the final screen is "Complete Your Verification": English-only, full progress, direct PayPro', () => {
  const g = fnBody(FLOW, 'GetVerifiedStep')
  assert.match(g, /heading="Complete Your Verification"/, 'heading')
  assert.match(g, /You pay no commission to TutorMint/, 'the commission message')
  assert.match(g, /Spam Free Platform Fee: Rs 199\. We keep TutorMint clean of fake and spam accounts\./, 'the fee line')
  // HOTFIX-G4b: button label carries no amount; the failure line is the shared
  // reason-based message (see the dedicated HOTFIX test).
  assert.match(g, /Get verified now/, 'the one red button label, no amount')
  assert.match(g, /useVerifyCheckout\(\)/, 'uses the direct-PayPro hook')
  assert.match(g, /stepIndex=\{stepTotal\}/, 'progress bar is full (stepIndex === stepTotal)')
  assert.match(g, /CHECKOUT_FAIL_MESSAGES\[reason\]/, 'friendly reason-based failure line')
  assert.match(g, /What do I get\?/, '"What do I get?" link')
  assert.match(g, /VerifyBenefitsDialog/, 'opens the shared benefits pop-up')
  // English only on THIS screen: no Urdu, no Ltr, and none of the removed clutter.
  assert.ok(!URDU.test(g), 'no Urdu on the final screen')
  for (const gone of ['Complete verification', 'Continue to become', 'being checked', 'TutorVerifyGate', 'Pay later', 'bank transfer']) {
    assert.ok(!new RegExp(gone).test(g), `"${gone}" is not on the final screen`)
  }
  // the whole flow no longer pulls in the old gate
  assert.ok(!/from '@\/components\/upgrade\/TutorVerifyGate'/.test(FLOW), 'NewOnboardingFlow no longer imports TutorVerifyGate')
})

test('the PayPro hook reuses a pending invoice via /api/payments/checkout, and fails friendly', () => {
  const h = read('components/tutor/useVerifyCheckout.ts')
  assert.match(h, /\/api\/payments\/checkout/, 'hits the checkout route')
  assert.match(h, /body: JSON\.stringify\(\{ planCode: 'verified' \}\)/, 'posts the verification fee with no payment method → the online (PayPro) path')
  assert.match(h, /data\?\.mode === 'redirect'/, 'a redirect navigates; any non-redirect sets a reason (see the HOTFIX test), never a raw error')
  // the checkout route still routes the no-method verified path through startPayproCheckout,
  // which reuses a < 24h pending invoice.
  const route = read('app/api/payments/checkout/route.ts')
  assert.match(route, /startPayproCheckout\(/, 'checkout calls startPayproCheckout')
  const pp = read('lib/payments/paypro.ts')
  assert.match(pp, /ageMs < DAY_MS && click2pay/, 'startPayproCheckout reuses a fresh pending order')
})

// --------------------------------------------- STEP 2: dashboard card -------
test('the value-first card uses the real count + city and carries no money words', () => {
  const c = read('components/tutor/GetVerifiedValueCard.tsx')
  assert.match(c, /count > 0/, 'uses the real count')
  assert.match(c, /\$\{count\} \$\{tuition\} in \$\{city\} waiting for tutors like you/, 'N tuitions in {city} title')
  assert.match(c, /Get verified so parents in \$\{city\} can find and contact you\./, 'N = 0 fallback')
  assert.match(c, /Get verified to apply and contact parents directly\./, 'the small line')
  assert.match(c, /bg-tm-tint-green/, 'light mint background')
  assert.match(c, /border-tm-green-deep/, 'deep green border')
  assert.match(c, /bg-tm-green-deep[^]*Get verified/, 'deep green "Get verified" button')
  assert.match(c, /useVerifyCheckout\(\)/, 'straight to PayPro')
  // no "payment"/"fee" words anywhere the card renders (comment reworded to avoid them)
  assert.ok(!/payment|\bfee\b/i.test(c), 'no money words on the card')
})

test('the dashboard swaps the card by the switch; non-staff keep the pending-invoice prompt', () => {
  const page = read('app/(site)/tutor/dashboard/page.tsx')
  assert.match(page, /showNewOnboarding\(await getOnboardingMode\(\), !!session\?\.profile\?\.admin_role\)/, 'staffNew from the switch')
  assert.match(page, /const showValueCard = staffNew && !ent\.verified/, 'value card only for staff + unverified')
  assert.match(page, /!staffNew && !ent\.verified \? await pendingPayproInvoice/, 'pending prompt only for non-staff')
  assert.match(page, /\{showValueCard && <GetVerifiedValueCard count=\{boardCount\} city=\{city\}/, 'card uses the Find-tuitions count')
  assert.match(page, /\{pendingInvoice && <CompletePaymentPrompt/, 'non-staff path unchanged')
})

// --------------------------------------------- STEP 3: hide bank/pay later --
test('TutorVerifyGate hides bank transfer + "Pay later" only when hideManual (default off)', () => {
  const t = read('components/upgrade/TutorVerifyGate.tsx')
  assert.match(t, /hideManual = false/, 'defaults off → non-staff unchanged')
  assert.match(t, /\{!hideManual && \(manual \?/, 'bank/transfer gated by hideManual')
  assert.match(t, /\{!hideManual && payLaterHref &&/, '"Pay later" gated by hideManual')
})

test('the apply-gate modal resolves staff via /api/onboarding/mode and passes hideManual', () => {
  const s = read('components/upgrade/UpgradeSheet.tsx')
  assert.match(s, /fetch\('\/api\/onboarding\/mode'\)/, 'reads the switch decision')
  assert.match(s, /useState\(false\)/, 'defaults false = today’s screen')
  assert.match(s, /<TutorVerifyGate onClose=\{onClose\} hideManual=\{hideManual\}/, 'passes hideManual')
  const route = read('app/api/onboarding/mode/route.ts')
  assert.match(route, /showNewOnboarding\(mode, isStaff\)/, 'the endpoint resolves the same way')
})

test('Membership Plans hides bank + "Pay later" for staff, keeps Back; transfer button gated', () => {
  const page = read('app/(site)/membership-plans/page.tsx')
  assert.match(page, /staffNew = showNewOnboarding\(await getOnboardingMode\(\), !!me\?\.admin_role\)/, 'staffNew on the page')
  assert.match(page, /staffNew \? \(/, 'payFooter branches on staffNew')
  assert.match(page, /hideTransfer=\{staffNew\}/, 'PackagesTable transfer gated')
  // staff footer keeps Back, drops the bank card + Pay later
  const staffFooter = page.slice(page.indexOf('staffNew ? ('), page.indexOf('const tutorCurrent'))
  assert.match(staffFooter, /Back/, 'staff keeps the Back exit')
  const pt = read('components/PackagesTable.tsx')
  assert.match(pt, /hideTransfer = false/, 'PackagesTable default keeps transfer for everyone else')
  assert.match(pt, /showTransfer=\{!hideTransfer\}/, 'BuyButton transfer follows hideTransfer')
})

test('/pay/manual still works and bank details are not deleted (staff can still share manually)', () => {
  assert.ok(existsSync(join(ROOT, 'app/(site)/pay/manual/[ref]/page.tsx')), '/pay/manual route kept')
  assert.ok(existsSync(join(ROOT, 'app/admin/payments/bank-details/page.tsx')), 'admin bank details kept')
})

// --------------------------------------------- the switch itself ------------
test('the switch gates everything: non-staff unchanged until "everyone"', () => {
  assert.equal(showNewOnboarding('staff', false), false, 'a normal tutor sees today’s screens')
  assert.equal(showNewOnboarding('staff', true), true, 'owner/staff see the new ones')
  assert.equal(showNewOnboarding('off', true), false, 'off = nobody')
  assert.equal(showNewOnboarding('everyone', false), true, 'everyone = all tutors')
})
