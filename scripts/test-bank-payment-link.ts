/**
 * scripts/test-bank-payment-link.ts — Link a bank credit to a member (owner,
 * 20 Oct 2026). Pure rules plus source scans; nothing touches a database.
 *
 *   npm run test:bankpaymentlink
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ALREADY_PAID,
  bankPaymentRow,
  creditLinkable,
  creditPaidAt,
  linkDecision,
  type LinkFacts,
} from '../lib/bankPaymentLinkCore'
import { countedInMonth, methodLabel, pkMonth, type FinancePayment } from '../lib/financeCore'
import { pkDay } from '../lib/settlementCore'
import { firstPaidAt } from '../lib/staffTargetsCore'
import { buildBoard, type Credit } from '../lib/settlementMatchCore'
import { canApprove } from '../lib/adminAccessCore'
import { AUDIT_LABELS } from '../lib/timelineLabelsCore'

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')

const FEE = { code: 'verified', name: 'Verification Fee', audience: 'tutor', pricePkr: 199, active: true }
const PREMIUM = { code: 'premium', name: 'Premium', audience: 'tutor', pricePkr: 499, active: true }

const base = (over: Partial<LinkFacts> = {}): LinkFacts => ({
  memberRole: 'tutor',
  feePaidAt: null,
  plan: FEE,
  payments: [],
  subs: [],
  creditState: 'unmatched',
  creditAmountPkr: 199,
  amountPkr: 199,
  ...over,
})

// The credit of 20 Oct 2026, 21:40 Pakistan time: 16:40 UTC, still 20 Oct in Pakistan.
const PAID_AT = creditPaidAt('2026-10-20', '21:40')

/** The one approved payment a link leaves behind, as the finance loader reads it. */
function linkedPayment(): FinancePayment {
  const row = bankPaymentRow({ userId: 'u1', planCode: 'verified', amountPkr: 199, providerRef: 'TM-1', bankReference: 'RAAST123', creditId: 'c1', creditDate: '2026-10-20' })
  return {
    id: 'p1',
    ref: row.provider_ref,
    userId: row.user_id,
    planCode: row.plan_code,
    audience: 'tutor',
    amountPkr: row.amount_pkr,
    refundedAmountPkr: null,
    refundedAt: null,
    approvedAt: PAID_AT,
    provider: row.provider,
    method: methodLabel(null, row.method, row.provider),
    note: row.note,
  }
}

test('the payment is dated when the money arrived, in Pakistan time', () => {
  assert.equal(PAID_AT, '2026-10-20T16:40:00.000Z')
  assert.equal(pkDay(PAID_AT), '2026-10-20')
  // Late at night stays on the credit's own day, not the next UTC day.
  assert.equal(pkDay(creditPaidAt('2026-10-20', '23:59')), '2026-10-20')
  assert.equal(pkDay(creditPaidAt('2026-10-20', null)), '2026-10-20')
})

test('linking creates exactly one approved bank-transfer payment that counts in Revenue on the credit date', () => {
  const row = bankPaymentRow({ userId: 'u1', planCode: 'verified', amountPkr: 199, providerRef: 'TM-1', bankReference: 'RAAST123', creditId: 'c1', creditDate: '2026-10-20' })
  assert.equal(row.provider, 'manual')
  assert.equal(row.method, 'bank')
  assert.equal(row.reference, 'RAAST123')
  assert.equal(row.amount_pkr, 199)
  assert.deepEqual(row.raw, { bankTransferId: 'c1' })
  const p = linkedPayment()
  assert.equal(p.method, 'Bank transfer')
  const oct = countedInMonth([p], pkMonth(PAID_AT))
  assert.equal(oct.length, 1)
  assert.equal(oct.reduce((s, x) => s + x.amountPkr, 0), 199)
  assert.equal(countedInMonth([p], '2026-11').length, 0)
  // The server inserts once and sets reviewed_at to the credit time.
  const src = read('lib/bankPaymentLink.ts')
  assert.equal(src.match(/from\('payments'\)\.insert\(/g)?.length, 1)
  assert.ok(src.includes(".update({ reviewed_at: paidAt })"))
})

test('it counts as the paid sign-up for the staff member credited with that sign-up', () => {
  const p = { planCode: 'verified', status: 'approved', approvedAt: PAID_AT, refundedAmountPkr: null, refundedAt: null }
  assert.equal(firstPaidAt([p], 'tutor'), PAID_AT)
  // Staff credit reads approved payments by reviewed_at, any provider.
  for (const f of ['lib/staffSignups.ts', 'lib/mySignups.ts']) {
    const s = read(f)
    assert.ok(s.includes("from('payments')") && s.includes("eq('status', 'approved')") && !/eq\('provider'/.test(s), f)
  }
})

test('a fee the member already paid is refused', () => {
  const d = linkDecision(base({ payments: [{ id: 'p0', planCode: 'verified', status: 'approved' }], feePaidAt: '2026-10-01T00:00:00Z' }))
  assert.deepEqual(d, { ok: false, error: ALREADY_PAID })
  assert.equal(ALREADY_PAID, 'This member has already paid this fee.')
  // A refunded fee payment no longer blocks a new one.
  assert.equal(linkDecision(base({ payments: [{ id: 'p0', planCode: 'verified', status: 'approved', refundedAt: '2026-10-02' }] })).ok, true)
  // A plan whose current period is already paid for.
  const paidSub = linkDecision(
    base({ plan: PREMIUM, creditAmountPkr: 499, amountPkr: 499, feePaidAt: 'x', payments: [{ id: 'p9', planCode: 'premium', status: 'approved' }], subs: [{ id: 's1', planCode: 'premium', status: 'active', paymentId: 'p9' }] }),
  )
  assert.deepEqual(paidSub, { ok: false, error: ALREADY_PAID })
})

test('a manual grant is attached to, never granted again', () => {
  assert.deepEqual(linkDecision(base({ feePaidAt: '2026-10-20T10:00:00Z' })), { ok: true, mode: 'attach', subscriptionId: null })
  assert.deepEqual(linkDecision(base()), { ok: true, mode: 'activate' })
  assert.deepEqual(
    linkDecision(base({ plan: PREMIUM, creditAmountPkr: 499, amountPkr: 499, feePaidAt: 'x', subs: [{ id: 's1', planCode: 'premium', status: 'active', paymentId: null }] })),
    { ok: true, mode: 'attach', subscriptionId: 's1' },
  )
  // Attach never calls the activation (which would grant or extend).
  const src = read('lib/bankPaymentLink.ts')
  const attach = src.slice(src.indexOf('} else {'), src.indexOf('Revenue and every paid count'))
  assert.ok(!attach.includes('activatePayment('))
  assert.ok(attach.includes("update({ payment_id: paymentId })"))
})

test('only an unmatched credit may be linked, for the right audience and amount', () => {
  assert.equal(creditLinkable('unmatched'), true)
  assert.equal(creditLinkable('held'), true)
  assert.equal(creditLinkable('matched'), false)
  assert.equal(creditLinkable('ignored'), false)
  assert.equal(linkDecision(base({ creditState: 'matched' })).ok, false)
  assert.equal(linkDecision(base({ memberRole: 'parent' })).ok, false)
  assert.equal(linkDecision(base({ amountPkr: 250 })).ok, false)
  assert.equal(linkDecision(base({ plan: PREMIUM, creditAmountPkr: 499, amountPkr: 499 })).ok, false, 'a plan needs the fee first')
})

test('recording a bank payment is Owner only on the server', () => {
  assert.equal(canApprove('owner'), true)
  for (const r of ['partner', 'admin', 'operations', 'tuitions_staff'] as const) assert.equal(canApprove(r), false, r)
  const route = read('app/api/admin/payments/bank-link/route.ts')
  const post = route.slice(route.indexOf('export async function POST'))
  const gate = post.indexOf('checkAdminRole(')
  const owner = post.indexOf('refuseUnlessOwnerApproval(gate.actor')
  const write = post.indexOf('linkCreditToMember(')
  assert.ok(gate > 0 && owner > gate && write > owner, 'gate → Owner-only → write')
  assert.ok(post.includes('if (notOwner) return notOwner'))
  assert.ok(post.includes('requireFreshAuth('))
  assert.ok(AUDIT_LABELS['payment.bank_link'])
  assert.ok(read('lib/bankPaymentLink.ts').includes("action: 'payment.bank_link'"))
})

test('the settlement check shows the credit matched to the linked payment', () => {
  const credit: Credit = { id: 'c1', date: '2026-10-20', time: '21:40', amountPkr: 199, senderName: 'AYAZ', senderBank: 'Raast', reference: 'RAAST123', note: null, isPaypro: false }
  const before = buildBoard({ rows: [], credits: [credit], ourPaypro: [], receipts: [], links: [], nowIso: '2026-10-20T17:00:00Z' })
  assert.equal(before.credits[0].state, 'unmatched')
  const after = buildBoard({
    rows: [],
    credits: [credit],
    ourPaypro: [],
    receipts: [{ id: 'p1', ref: 'TM-1', amountPkr: 199, approvedDay: pkDay(PAID_AT), transactionId: 'RAAST123', payerName: 'Ayaz Hussain' }],
    links: [{ transferId: 'c1', kind: 'receipt', target: 'p1', note: 'Linked to Ayaz Hussain (Verification Fee)' }],
    nowIso: '2026-10-20T17:00:00Z',
  })
  assert.equal(after.credits[0].state, 'matched')
  assert.deepEqual(after.credits[0].match?.receipts, ['p1'])
  assert.equal(after.receipts[0].state, 'matched')
  assert.ok(read('lib/bankPaymentLink.ts').includes("kind: 'receipt', target: paymentId"))
})
