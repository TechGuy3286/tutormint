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

import { onlinePaymentOpenFrom } from '../lib/payments/paymentOpen'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// ------------------------------------------- the open check (§1) -----------

test('online payment is OPEN only when the gateway is configured AND live (not sandbox)', () => {
  assert.equal(onlinePaymentOpenFrom({ configured: true, sandbox: false }), true, 'configured + live → open')
  assert.equal(onlinePaymentOpenFrom({ configured: true, sandbox: true }), false, 'sandbox → not open to normal members')
  assert.equal(onlinePaymentOpenFrom({ configured: false, sandbox: false }), false, 'unconfigured → closed')
  assert.equal(onlinePaymentOpenFrom({ configured: false, sandbox: true }), false)
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
  // pproVisibleFor offers PayPro to everyone when live (sandbox stays test-only).
  assert.ok(src.includes('if (pproSandbox()) return checkoutVisibleFor(profile)'))
})

test('the verify/fee step still shows the closed notice only on checkout_closed, and offers bank transfer', () => {
  const src = read('components/upgrade/TutorVerifyGate.tsx')
  assert.ok(src.includes("data?.code === 'checkout_closed'"), 'closed notice only on a genuine checkout_closed')
  assert.ok(src.includes("start('transfer')"), 'bank transfer is offered as the second option')
})
