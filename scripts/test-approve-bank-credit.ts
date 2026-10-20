/**
 * scripts/test-approve-bank-credit.ts — a bank credit wrongly GUESSED to match
 * another member's receipt is linked to the member who really paid; open
 * checkouts close once a fee is paid; Revenue and Paid count every method;
 * the Review button and the tutor status on finished tutors (owner, 21 Oct
 * 2026). Pure rules plus source scans; nothing touches a database.
 *
 *   npm run test:approvebankcredit
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ALREADY_PAID, autoReceiptMatch, bankPaymentRow, creditLinkable, creditPaidAt, linkDecision, type LinkFacts } from '../lib/bankPaymentLinkCore'
import { buildBoard, type Credit, type Receipt } from '../lib/settlementMatchCore'
import { countedInMonth, methodLabel, pkMonth, type FinancePayment } from '../lib/financeCore'
import { feePayersInRange } from '../lib/overviewItemsCore'
import { pkDay } from '../lib/settlementCore'
import { checkoutsToClose, PAID_ANOTHER_WAY, type OpenCheckoutRow } from '../lib/payments/closeOtherCheckoutsCore'
import { paymentLabel, paymentState } from '../lib/paymentLabelCore'
import { showReviewButton } from '../lib/tutorDocSummaryCore'
import { tutorStatusFact } from '../lib/memberPageCore'
import { timelineSentence } from '../lib/timelineText'

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')

const FEE = { code: 'verified', name: 'Verification Fee', audience: 'tutor', pricePkr: 199, active: true }

// Ayaz Hussain's Rs 199 Raast credit of 20 Oct 2026 (no time recorded) and the
// other tutor's approved bank receipt of 18 Oct that the same-amount rule
// picked for it.
const CREDIT: Credit = { id: 'c1', date: '2026-10-20', time: null, amountPkr: 199, senderName: null, senderBank: null, reference: '261838203082', note: null, isPaypro: false }
const OTHER: Receipt = { id: 'saleem', ref: 'TM-MVCYYLHV-ED2EEA6E1C85', amountPkr: 199, approvedDay: '2026-10-18', transactionId: null, payerName: 'Saleem Khan' }
const NOW = '2026-10-21T08:00:00Z'

const facts = (over: Partial<LinkFacts> = {}): LinkFacts => ({
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

test('a credit guessed to match another receipt can be linked to the member who paid', () => {
  const guessed = buildBoard({ rows: [], credits: [CREDIT], ourPaypro: [], receipts: [OTHER], links: [], nowIso: NOW })
  const c = guessed.credits[0]
  assert.equal(c.state, 'matched', 'the same-amount rule guesses it')
  assert.notEqual(c.match?.status, 'manual')
  assert.equal(autoReceiptMatch(c.state, c.match), true)
  assert.equal(creditLinkable(c.state, c.match), true)
  assert.deepEqual(linkDecision(facts({ creditState: c.state, creditMatch: c.match })), { ok: true, mode: 'activate' })

  // A match made by hand, or one paying PayPro orders, is never replaced here.
  const byHand = { status: 'manual', orders: [], receipts: ['saleem'] }
  assert.equal(creditLinkable('matched', byHand), false)
  assert.equal(linkDecision(facts({ creditState: 'matched', creditMatch: byHand })).ok, false)
  assert.equal(creditLinkable('matched', { status: 'matched', orders: ['TM-1'], receipts: [] }), false)
  assert.equal(creditLinkable('matched', null), false)
  assert.equal(creditLinkable('ignored', null), false)

  // After linking, the manual link wins: the credit pays the new payment and
  // the other tutor's receipt goes back to waiting for its own credit.
  const paidAt = creditPaidAt(CREDIT.date, CREDIT.time)
  const mine: Receipt = { id: 'ayaz', ref: 'TM-NEW', amountPkr: 199, approvedDay: pkDay(paidAt), transactionId: '261838203082', payerName: 'Ayaz Hussain' }
  const linked = buildBoard({
    rows: [],
    credits: [CREDIT],
    ourPaypro: [],
    receipts: [OTHER, mine],
    links: [{ transferId: 'c1', kind: 'receipt', target: 'ayaz', note: 'Linked to Ayaz Hussain (Verification Fee)' }],
    nowIso: NOW,
  })
  assert.equal(linked.credits[0].match?.status, 'manual')
  assert.deepEqual(linked.credits[0].match?.receipts, ['ayaz'])
  assert.equal(linked.receipts.find((r) => r.id === 'saleem')?.state, 'waiting')

  // The board shows the button on such a credit; the server passes the match in.
  assert.ok(read('app/admin/finance/settlement/SettlementsBoard.tsx').includes('autoReceiptMatch(c.state, m)'))
  assert.ok(read('lib/bankPaymentLink.ts').includes('creditMatch: credit.match'))
})

test('the linked payment counts in Revenue and Paid on the credit date', () => {
  const paidAt = creditPaidAt(CREDIT.date, CREDIT.time)
  assert.equal(pkDay(paidAt), '2026-10-20')
  const row = bankPaymentRow({ userId: 'ayaz', planCode: 'verified', amountPkr: 199, providerRef: 'TM-NEW', bankReference: CREDIT.reference, creditId: 'c1', creditDate: CREDIT.date })
  const p: FinancePayment = {
    id: 'p1', ref: row.provider_ref, userId: row.user_id, planCode: row.plan_code, audience: 'tutor', amountPkr: row.amount_pkr,
    refundedAmountPkr: null, refundedAt: null, approvedAt: paidAt, provider: row.provider, method: methodLabel(null, row.method, row.provider), note: row.note,
  }
  assert.equal(countedInMonth([p], pkMonth(paidAt)).length, 1)
  const day = Date.parse('2026-10-20T00:00:00+05:00')
  assert.equal(feePayersInRange([{ userId: 'ayaz', approvedAt: paidAt, refundedAmountPkr: null, refundedAt: null }], day, day + 86_400_000).length, 1)
})

test('no double grant: a manual grant is attached to, and a paid fee is refused', () => {
  assert.deepEqual(linkDecision(facts({ feePaidAt: '2026-10-20T14:08:34Z' })), { ok: true, mode: 'attach', subscriptionId: null })
  const src = read('lib/bankPaymentLink.ts')
  const attach = src.slice(src.indexOf('} else {'), src.indexOf('Revenue and every paid count'))
  assert.ok(!attach.includes('activatePayment('), 'attach never grants again')
  assert.deepEqual(
    linkDecision(facts({ feePaidAt: 'x', payments: [{ id: 'p0', planCode: 'verified', status: 'approved' }] })),
    { ok: false, error: ALREADY_PAID },
  )
})

test('once paid, other open checkouts for the same fee close as "Paid by another method"', () => {
  const row = (id: string, over: Partial<OpenCheckoutRow> = {}): OpenCheckoutRow => ({
    id, planCode: 'verified', status: 'pending', provider: 'paypro', hasScreenshot: false, reference: null, closedAt: null, refundedAt: null, ...over,
  })
  const rows = [
    row('paid', { status: 'approved', provider: 'manual' }),
    row('paypro-open'), // Ayaz's PayPro "started, not paid"
    row('other-plan', { planCode: 'premium' }),
    row('already-closed', { closedAt: '2026-10-20' }),
    row('receipt', { provider: 'manual', hasScreenshot: true }),
    row('typed-ref', { provider: 'manual', reference: 'RAAST 1' }),
    row('rejected', { status: 'rejected' }),
  ]
  assert.deepEqual(checkoutsToClose(rows, { id: 'paid', planCode: 'verified' }), ['paypro-open'])
  assert.equal(PAID_ANOTHER_WAY, 'paid_another_way')

  // The member page and the timeline say so in words.
  const label = paymentLabel(
    { planCode: 'verified', amountPkr: 199, status: 'pending', provider: 'paypro', createdAt: '2026-10-20T11:04:49Z', hasReceipt: false, checkoutClosedAt: NOW, checkoutCloseReason: PAID_ANOTHER_WAY },
    Date.parse(NOW),
    { showAmount: true },
  )
  assert.equal(label, 'Verification Fee Rs 199 — cancelled, paid by another method')
  assert.notEqual(paymentState({ planCode: 'verified', amountPkr: 199, status: 'pending', provider: 'paypro', createdAt: '2026-10-20T11:04:49Z', hasReceipt: false, checkoutClosedAt: NOW, checkoutCloseReason: PAID_ANOTHER_WAY }, Date.parse(NOW)), 'started_not_paid')
  assert.equal(timelineSentence('checkout_cancelled', { reason: PAID_ANOTHER_WAY }), 'A started payment was closed: paid by another method')

  // Every approval path closes them: both branches of activatePayment, and the
  // bank-credit attach step.
  const act = read('lib/payments/activate.ts')
  assert.equal(act.match(/await closeOtherCheckouts\(/g)?.length, 2)
  assert.ok(read('lib/bankPaymentLink.ts').includes('await closeOtherCheckouts('))
  assert.ok(read('supabase/migrations/189_checkout_paid_another_way.sql').includes("'paid_another_way'"))
})

test('Revenue and Paid count every approved payment method', () => {
  const at = '2026-10-20T10:00:00Z'
  const base = { audience: 'tutor', amountPkr: 199, refundedAmountPkr: null, refundedAt: null, approvedAt: at, note: null, planCode: 'verified' }
  const pays: FinancePayment[] = [
    { ...base, id: 'a', ref: 'A', userId: 'u1', provider: 'paypro', method: methodLabel('JazzCash', null, 'paypro') },
    { ...base, id: 'b', ref: 'B', userId: 'u2', provider: 'manual', method: methodLabel(null, 'bank', 'manual') }, // approved bank receipt
    { ...base, id: 'c', ref: 'C', userId: 'u3', provider: 'manual', method: methodLabel(null, 'bank', 'manual') }, // bank credit linked
    { ...base, id: 'd', ref: 'D', userId: 'u4', provider: 'manual', method: methodLabel(null, 'bank', 'manual') }, // guessed credit re-linked
  ]
  assert.equal(countedInMonth(pays, '2026-10').length, 4)
  const day = Date.parse('2026-10-20T00:00:00+05:00')
  assert.equal(feePayersInRange(pays.map((p) => ({ userId: p.userId, approvedAt: p.approvedAt, refundedAmountPkr: null, refundedAt: null })), day, day + 86_400_000).length, 4)
  // The loaders read approved payments with no filter on provider or method.
  for (const [file, from] of [
    ['lib/finance.ts', 'export const loadFinancePayments'],
    ['lib/overviewItems.ts', "case 'paid-today'"],
  ] as const) {
    const src = read(file)
    const body = src.slice(src.indexOf(from), src.indexOf(from) + 1500)
    assert.ok(body.includes("eq('status', 'approved')"), file)
    assert.ok(!/eq\('(provider|method)'/.test(body), `${file} must not filter by provider or method`)
  }
})

test('the red Review button is hidden on tutors with nothing to review', () => {
  assert.equal(showReviewButton('/admin/tutors/x', { kind: 'approved' }), false)
  assert.equal(showReviewButton('/admin/tutors/x', { kind: 'none' }), false)
  assert.equal(showReviewButton('/admin/tutors/x', { kind: 'rejected' }), false)
  assert.equal(showReviewButton('/admin/tutors/x', { kind: 'partial' }), false)
  assert.equal(showReviewButton('/admin/tutors/x', { kind: 'waiting' }), true)
  assert.equal(showReviewButton('/admin/users/p', null), true, 'a parent card keeps it')
  assert.equal(showReviewButton(null, { kind: 'waiting' }), false)
  assert.ok(read('components/admin/OverviewCardGrid.tsx').includes('showReviewButton(it.reviewHref, it.docs)'))
})

test('a paid tutor with approved documents reads Verified, else the real reason', () => {
  assert.equal(tutorStatusFact('pending', { feePaid: true, docKind: 'approved' }), 'Verified')
  assert.equal(tutorStatusFact('pending', { feePaid: false, docKind: 'approved' }), 'Pending: fee not paid')
  assert.equal(tutorStatusFact('pending', { feePaid: true, docKind: 'waiting' }), 'Pending: documents waiting')
  assert.equal(tutorStatusFact('suspended', { feePaid: true, docKind: 'approved' }), 'Suspended')
})
