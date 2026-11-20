/**
 * scripts/test-paypro-retire.ts — PayPro retired (owner, 26 Oct 2026).
 *   npm run test:payproretire
 *
 * Checks: PayPro is hidden everywhere a payment starts; new PayPro checkouts are
 * refused on the server with the bank-transfer message; the listener keeps
 * activating through the cut-off day and after it only records; past PayPro
 * records are untouched by the migration; the English wording is updated.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  DEFAULT_CHECKOUT_METHODS,
  DEFAULT_GATEWAY_SETTINGS,
  PAYPRO_RETIRED,
  bankTransferOn,
  checkoutMethodsOf,
  onlineCheckoutOn,
} from '../lib/payments/gatewaySettingsCore'
import {
  PAYPRO_CLOSED_MESSAGE,
  PAYPRO_CUTOFF_DEFAULT,
  PAY_BY_TRANSFER_LINE,
  parsePayproCutoff,
  payproMayActivate,
  pkDay,
} from '../lib/payments/payproRetireCore'

const read = (f: string) => readFileSync(f, 'utf8')

test('PayPro is retired: no online checkout, bank transfer always on', () => {
  assert.equal(PAYPRO_RETIRED, true)
  const allOn = { ...DEFAULT_GATEWAY_SETTINGS, active: 'paypro' as const, methods: { ...DEFAULT_GATEWAY_SETTINGS.methods, paypro_online: true, bank_transfer: false } }
  assert.equal(onlineCheckoutOn(allOn), false)
  assert.equal(bankTransferOn(allOn), true)
  assert.equal(checkoutMethodsOf(allOn).online, false)
  assert.equal(DEFAULT_CHECKOUT_METHODS.online, false)
  assert.equal(DEFAULT_CHECKOUT_METHODS.bankTransfer, true)
})

test('the cut-off: activate through the last day, Pakistan time; record only after', () => {
  // PR-12 (owner, 20 Nov 2026 — "stop now"): the last day moved to 19 Nov.
  assert.equal(PAYPRO_CUTOFF_DEFAULT, '2026-11-19')
  // 25 Nov 23:59 PKT = 25 Nov 18:59 UTC → still activates.
  assert.equal(payproMayActivate(new Date('2026-11-25T18:59:00Z'), '2026-11-25'), true)
  // 26 Nov 00:01 PKT = 25 Nov 19:01 UTC → after the cut-off.
  assert.equal(payproMayActivate(new Date('2026-11-25T19:01:00Z'), '2026-11-25'), false)
  assert.equal(pkDay(new Date('2026-10-26T20:00:00Z')), '2026-10-27')
  // A broken setting falls back to the default day, never to "always".
  assert.equal(parsePayproCutoff('soon'), PAYPRO_CUTOFF_DEFAULT)
  assert.equal(payproMayActivate(new Date('2027-01-01T00:00:00Z'), 'garbage'), false)
})

// PR-12 (owner, 20 Nov 2026): PayPro has ENDED. Nothing calls PayPro, nothing
// activates; a late "paid" callback is logged and recorded for the Owner.
test('PR-12: the confirm path never activates and never calls PayPro; a late notice is recorded', () => {
  const src = read('lib/payments/payproReconcile.ts')
  assert.doesNotMatch(src, /activatePayment|getPayproOrderStatus/)
  assert.match(src, /reason: 'paypro_ended'/)
  assert.match(src, /kind: 'paypro_late'/)
})

test('PR-12: /paypro/uis answers safely — logs, never activates, never needs a PAYPRO_* variable', () => {
  const src = read('app/paypro/uis/route.ts')
  assert.match(src, /recordGatewayEvent\('paypro', 'callback'/)
  assert.doesNotMatch(src, /process\.env|activatePayment|confirmPayproOrder/)
  assert.match(src, /StatusCode: '03', InvoiceID: id, Description: 'No records found\.'/)
})

test('new PayPro checkouts are refused on the server with the bank-transfer message', () => {
  const src = read('app/api/payments/checkout/route.ts')
  assert.match(src, /if \(!wantsTransfer\) \{\s*\n\s*return NextResponse\.json\(\{ error: PAYPRO_CLOSED_MESSAGE/)
  assert.doesNotMatch(src, /startPayproCheckout/)
  assert.match(PAYPRO_CLOSED_MESSAGE, /bank transfer/)
  assert.match(read('app/api/admin/paypro/test-order/route.ts'), /status: 410/)
})

test('the payment screen offers bank transfer only, with the plain line', () => {
  const src = read('app/(site)/pay/choose/PayChoice.tsx')
  assert.doesNotMatch(src, /JazzCash \(PayPro\)|Continue to JazzCash|useVerifyCheckout/)
  assert.match(src, /PAY_BY_TRANSFER_LINE/)
  assert.equal(PAY_BY_TRANSFER_LINE, 'Pay from JazzCash, Easypaisa or any bank app using Raast or bank transfer.')
  const page = read('app/(site)/pay/choose/page.tsx')
  assert.doesNotMatch(page, /pproVisibleFor|onlineCheckoutOn/)
})

test('the PayPro "Complete your payment" prompt is gone from the dashboard (owner, 31 Oct 2026)', () => {
  const dash = read('app/(site)/tutor/dashboard/page.tsx')
  assert.doesNotMatch(dash, /CompletePaymentPrompt|pendingPayproInvoice/)
})

test('member-facing English no longer offers PayPro or card payment', () => {
  const files = [
    'components/PackagesTable.tsx',
    'app/(site)/membership-plans/page.tsx',
    'app/(site)/support/page.tsx',
    'app/(site)/terms/page.tsx',
    'lib/faqContent.ts',
    'lib/tutorFollowUpCore.ts',
  ]
  for (const f of files) {
    const english = read(f)
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l) && !/[؀-ۿ]/.test(l))
      .join('\n')
    assert.doesNotMatch(english, /JazzCash \(PayPro\)|Online payments \(JazzCash|Card payments through our gateway|pay by card or wallet through our payment gateway|If JazzCash gave a problem/, f)
  }
})

test('migration 200 never changes a past payment, refund or fee row', () => {
  const sql = read('supabase/migrations/200_paypro_retire_bank_reader.sql').toLowerCase()
  assert.doesNotMatch(sql, /update\s+public\.payments|delete\s+from|truncate|drop\s+table/)
  assert.doesNotMatch(sql, /update\s+public\.bank_transfers/)
})
