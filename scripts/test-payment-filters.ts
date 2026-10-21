/**
 * scripts/test-payment-filters.ts — the Payments page's two filters, waiting
 * receipts first, the old filter addresses, hidden nameless rows, header and
 * footer counts, and no negative gateway fee on screen (owner, 21 Oct 2026).
 * Pure rules plus source scans; nothing touches a database.
 *
 *   npm run test:paymentfilters
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  PAYMENT_FILTERS,
  WAITING_LABEL,
  defaultPaymentFilter,
  isNamelessPayment,
  legacyPaymentFilter,
  paymentBucket,
  paymentsHeading,
  sortPayments,
  type PaymentFilterFacts,
} from '../lib/paymentFiltersCore'
import { FEE_CHECK_WORDS, feeNeedsCheck, feeOf, feeTable, type OrderView } from '../lib/settlementMatchCore'

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
const NOW = Date.parse('2026-10-21T12:00:00Z')
const HOUR = 3_600_000

function facts(over: Partial<PaymentFilterFacts> = {}): PaymentFilterFacts {
  return {
    status: 'pending',
    provider: 'paypro',
    hasReceipt: false,
    payerReference: null,
    amountPkr: 199,
    refundedAmountPkr: null,
    refundedAt: null,
    checkoutClosedAt: null,
    checkoutCloseReason: null,
    createdAt: new Date(NOW - 3 * HOUR).toISOString(),
    hasMember: true,
    isTestAccount: false,
    ...over,
  }
}

test('exactly two filters', () => {
  assert.deepEqual(PAYMENT_FILTERS.map((f) => f.label), ['Paid / Completed', 'Unpaid / Incomplete'])
})

test('every payment status lands in the right filter', () => {
  const cases: [string, Partial<PaymentFilterFacts>, 'paid' | 'unpaid', string][] = [
    ['PayPro approved', { status: 'approved' }, 'paid', 'Paid'],
    ['approved bank receipt', { status: 'approved', provider: 'manual', hasReceipt: true }, 'paid', 'Paid'],
    ['linked bank credit', { status: 'approved', provider: 'manual', payerReference: 'RAAST123' }, 'paid', 'Paid'],
    ['receipt waiting', { provider: 'manual', hasReceipt: true }, 'unpaid', WAITING_LABEL],
    ['reference waiting', { provider: 'manual', payerReference: 'IBFT9' }, 'unpaid', WAITING_LABEL],
    ['started just now', { createdAt: new Date(NOW - 10 * 60_000).toISOString() }, 'unpaid', 'Started, not paid'],
    ['started, not paid', {}, 'unpaid', 'Started, not paid'],
    ['old, never closed', { createdAt: new Date(NOW - 72 * HOUR).toISOString() }, 'unpaid', 'Expired'],
    ['closed: expired', { checkoutClosedAt: '2026-10-19T00:00:00Z', checkoutCloseReason: 'expired' }, 'unpaid', 'Expired'],
    ['closed: member cancelled', { checkoutClosedAt: '2026-10-19T00:00:00Z', checkoutCloseReason: 'cancelled_by_member' }, 'unpaid', 'Cancelled'],
    ['closed: paid another way', { checkoutClosedAt: '2026-10-19T00:00:00Z', checkoutCloseReason: 'paid_another_way' }, 'unpaid', 'Cancelled'],
    ['closed: already paid', { checkoutClosedAt: '2026-10-19T00:00:00Z', checkoutCloseReason: 'already_paid' }, 'unpaid', 'Cancelled'],
    ['rejected', { status: 'rejected', provider: 'manual', hasReceipt: true }, 'unpaid', 'Rejected'],
    ['refunded', { status: 'approved', refundedAmountPkr: 199 }, 'unpaid', 'Refunded'],
    ['partly refunded', { status: 'approved', refundedAmountPkr: 50 }, 'unpaid', 'Partly refunded'],
    ['receipt on a PayPro row is not a review', { provider: 'paypro', hasReceipt: true }, 'unpaid', 'Started, not paid'],
  ]
  for (const [name, over, filter, label] of cases) {
    const b = paymentBucket(facts(over), NOW)
    assert.equal(b.filter, filter, name)
    assert.equal(b.label, label, name)
    assert.equal(b.waiting, label === WAITING_LABEL, name)
  }
})

test('waiting receipts sort first with the badge, the rest newest first', () => {
  const rows = [
    { id: 'a', waiting: false, createdAt: '2026-10-20T10:00:00Z' },
    { id: 'b', waiting: true, createdAt: '2026-10-10T10:00:00Z' },
    { id: 'c', waiting: false, createdAt: '2026-10-21T10:00:00Z' },
    { id: 'd', waiting: true, createdAt: '2026-10-18T10:00:00Z' },
  ]
  assert.deepEqual(sortPayments(rows).map((r) => r.id), ['d', 'b', 'c', 'a'])
  const queue = read('app/admin/payments/PaymentQueue.tsx')
  assert.match(queue, /label=\{WAITING_LABEL\} tone="pending"/)
  assert.match(queue, /canApprove && awaitingApproval\(p\) && \(\s*<PaymentDecide/)
})

test('default filter: Unpaid when receipts wait, else Paid', () => {
  assert.equal(defaultPaymentFilter(2), 'unpaid')
  assert.equal(defaultPaymentFilter(0), 'paid')
})

test('old filter addresses redirect to the matching new filter', () => {
  assert.equal(legacyPaymentFilter('approved'), 'paid')
  assert.equal(legacyPaymentFilter('receipts'), 'unpaid')
  assert.equal(legacyPaymentFilter('pending'), 'unpaid')
  assert.equal(legacyPaymentFilter('rejected'), 'unpaid')
  assert.equal(legacyPaymentFilter('all'), null)
  assert.equal(legacyPaymentFilter('paid'), 'paid')
  assert.equal(legacyPaymentFilter('unpaid'), 'unpaid')
  assert.equal(legacyPaymentFilter(undefined), undefined)
  const page = read('app/admin/payments/page.tsx')
  assert.match(page, /permanentRedirect\(/)
  // The access gate runs before the redirect, so a signed-out visitor goes to login.
  assert.ok(page.indexOf('requireAdminRole(') < page.indexOf('permanentRedirect('))
})

test('nameless rows are hidden by default with a show link; a waiting receipt never is', () => {
  assert.equal(isNamelessPayment(facts({ hasMember: false })), true)
  assert.equal(isNamelessPayment(facts({ isTestAccount: true })), true)
  assert.equal(isNamelessPayment(facts()), false)
  assert.equal(isNamelessPayment(facts({ hasMember: false, provider: 'manual', hasReceipt: true })), false)
  const queue = read('app/admin/payments/PaymentQueue.tsx')
  assert.match(queue, /Show \{counts\.hidden\} hidden/)
  const loader = read('lib/adminQueues.ts')
  assert.match(loader, /showHidden \|\| !r\.nameless/)
})

test('header and footer counts describe the same list', () => {
  assert.equal(paymentsHeading(38, 38), 'Payments (38)')
  assert.equal(paymentsHeading(25, 100), 'Payments — showing 25 of 100')
  assert.equal(paymentsHeading(0, 0), 'Payments')
  const queue = read('app/admin/payments/PaymentQueue.tsx')
  assert.match(queue, /paymentsHeading\(allPayments\.length, paymentsTotal\)/)
  assert.match(queue, /loadedCount=\{allPayments\.length\}\s*total=\{paymentsTotal\}/)
  const loader = read('lib/adminQueues.ts')
  // total and the chip counts come from the same filtered list.
  assert.match(loader, /total: list\.length, counts/)
})

test('no negative gateway fee is shown', () => {
  assert.equal(feeOf({ orderAmount: 199, merchantShare: 203 }), -4)
  assert.equal(feeNeedsCheck(-4), true)
  assert.equal(feeNeedsCheck(6), false)
  assert.equal(feeNeedsCheck(null), false)
  const order = (n: string, method: 'JazzCash' | 'Easypaisa', fee: number) =>
    ({ orderNumber: n, method, state: 'matched', datePaid: '2026-10-02', fee, orderAmount: 199 }) as unknown as OrderView
  const rows = feeTable([order('A', 'JazzCash', -1), order('B', 'JazzCash', 6), order('C', 'Easypaisa', -4)])
  for (const r of rows) {
    assert.ok(r.perOrder.every((n) => n >= 0))
    assert.ok(r.fees >= 0)
  }
  const jazz = rows.find((r) => r.method === 'JazzCash')!
  assert.deepEqual([jazz.orders, jazz.perOrder, jazz.fees, jazz.checkOrders], [2, [6], 6, ['A']])
  const ep = rows.find((r) => r.method === 'Easypaisa')!
  assert.deepEqual([ep.perOrder, ep.checkOrders], [[], ['C']])
  const board = read('app/admin/finance/settlement/SettlementsBoard.tsx')
  assert.match(board, /feeNeedsCheck\(o\.fee\) \? FEE_CHECK_WORDS/)
  assert.ok(board.includes('f.checkOrders'))
  assert.equal(FEE_CHECK_WORDS, 'Check with PayPro')
})
