/**
 * scripts/test-payment-open.ts  —  npm run test:paymentopen
 *
 * PR106-C0: the ONE payment-open check returns open when the PayPro gateway is
 * genuinely live, and every payment surface resolves through it. Pure logic +
 * a source scan; nothing here touches the DB.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { onlinePaymentOpenFrom, payproCardVisibleFrom } from '../lib/payments/paymentOpen'
import { payChoiceHref as payChoiceHrefForTest } from '../lib/returnTo'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// ------------------------------------------- the open check (§1) -----------

test('online payment is OPEN only when the gateway is configured AND live (not sandbox)', () => {
  assert.equal(onlinePaymentOpenFrom({ configured: true, sandbox: false }), true, 'configured + live → open')
  assert.equal(onlinePaymentOpenFrom({ configured: true, sandbox: true }), false, 'sandbox → not open to normal members')
  assert.equal(onlinePaymentOpenFrom({ configured: false, sandbox: false }), false, 'unconfigured → closed')
  assert.equal(onlinePaymentOpenFrom({ configured: false, sandbox: true }), false)
})

// ----- PR106-G2 §0: card checkout is open to EVERY tutor when live ---------

test('card checkout open to every signed-in tutor when PayPro is LIVE (mobile, email, staff, seed)', () => {
  const live = { configured: true, sandbox: false }
  const none: ReadonlySet<string> = new Set()
  const mobileTutor = { admin_role: null, is_seed: false, email: '923001234567@users.tutormint.org' }
  const emailTutor = { admin_role: null, is_seed: false, email: 'ali@gmail.com' }
  const staff = { admin_role: 'admin', is_seed: false, email: 'owner@tutormint.org' }
  const seed = { admin_role: null, is_seed: true, email: 'seed+x@tutormint.dev' }
  for (const p of [mobileTutor, emailTutor, staff, seed]) {
    assert.equal(payproCardVisibleFrom(p, live, none), true, `LIVE opens ${p.email}`)
  }
})

test('in SANDBOX only staff / seed / test-email may card-checkout; a normal tutor cannot', () => {
  const sandbox = { configured: true, sandbox: true }
  const testEmails: ReadonlySet<string> = new Set(['tester@gmail.com'])
  assert.equal(payproCardVisibleFrom({ admin_role: null, is_seed: false, email: '923001234567@users.tutormint.org' }, sandbox, testEmails), false, 'mobile tutor blocked in sandbox')
  assert.equal(payproCardVisibleFrom({ admin_role: null, is_seed: false, email: 'ali@gmail.com' }, sandbox, testEmails), false, 'email tutor blocked in sandbox')
  assert.equal(payproCardVisibleFrom({ admin_role: 'admin', is_seed: false, email: 'o@x' }, sandbox, testEmails), true, 'staff allowed in sandbox')
  assert.equal(payproCardVisibleFrom({ admin_role: null, is_seed: true, email: 's@x' }, sandbox, testEmails), true, 'seed allowed in sandbox')
  assert.equal(payproCardVisibleFrom({ admin_role: null, is_seed: false, email: 'tester@gmail.com' }, sandbox, testEmails), true, 'test email allowed in sandbox')
})

test('card checkout is never open when PayPro is unconfigured (bank transfer is the path)', () => {
  const off = { configured: false, sandbox: false }
  assert.equal(payproCardVisibleFrom({ admin_role: 'admin', is_seed: true, email: 'o@x' }, off, new Set()), false)
})

test('the checkout route no longer blocks transfer at the top; card gates via pproVisibleFor', () => {
  const r = read('app/api/payments/checkout/route.ts')
  assert.ok(!/!onlinePaymentOpen\(\) && !checkoutVisibleFor/.test(r), 'the launch-phase top gate is gone')
  assert.match(r, /if \(!wantsTransfer\) \{\s*\n\s*if \(!pproVisibleFor\(profile\)\)/, 'card gated; transfer falls through')
  assert.match(r, /code: 'use_transfer'/, 'card-not-open tells the UI to use transfer')
})

// --------------------------- every surface uses the ONE check (§1/§4) ------

test('the checkout route gate uses onlinePaymentOpen and no longer reads the manual switches', () => {
  const src = read('app/api/payments/checkout/route.ts')
  assert.ok(src.includes('onlinePaymentOpen()'), 'checkout gate resolves through onlinePaymentOpen')
  assert.ok(!src.includes('getPaymentSwitches'), 'no duplicated switch flag in the checkout gate')
  assert.ok(!src.includes('planOpenToAll'), 'no duplicated switch flag in the checkout gate')
})

test('the Membership Plans page uses onlinePaymentOpen for checkoutOpen', () => {
  const src = read('app/(site)/membership-plans/page.tsx')
  assert.ok(src.includes('onlinePaymentOpen()'), 'Membership Plans resolves through onlinePaymentOpen')
  assert.ok(!src.includes('getPaymentSwitches'), 'no duplicated switch flag on Membership Plans')
})

test('onlinePaymentOpen() is derived from the live-gateway facts, so it matches what checkout uses', () => {
  const src = read('lib/payments/paypro.ts')
  assert.ok(src.includes('export function onlinePaymentOpen()'), 'the shared check lives with the PayPro client')
  assert.ok(src.includes('onlinePaymentOpenFrom({ configured: pproConfigured(), sandbox: pproSandbox() })'))
  // pproVisibleFor now delegates to the pure payproCardVisibleFrom (open to
  // everyone when live, sandbox test-only) — the matrix is unit-tested above.
  assert.ok(src.includes('return payproCardVisibleFrom('), 'pproVisibleFor delegates to the pure helper')
})

// Repointed (owner, 11 Oct 2026): every paid checkout now opens the payment
// choice screen (/pay/choose) first — JazzCash (PayPro) or a bank transfer with
// a receipt — so the button no longer starts PayPro itself.
test('the verify/fee step opens the choice screen, where bank transfer is the second option', () => {
  const src = read('components/upgrade/TutorVerifyGate.tsx')
  // The choice screen for the fee, carrying the tuition to come back to (15 Oct 2026).
  assert.ok(src.includes("router.push(payChoiceHref('verified',"), 'Verify opens the choice screen')
  assert.equal(payChoiceHrefForTest('verified', null), '/pay/choose?plan=verified', 'for the fee')
  assert.ok(read('app/(site)/pay/choose/PayChoice.tsx').includes("OTHER_METHODS_TITLE = 'Other methods'"), 'bank transfer is offered as the second option')
})
