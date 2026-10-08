/**
 * scripts/test-settlement.ts — the settlement check per payment gateway (owner,
 * 6 Oct 2026). Pure rules only: the sums, the deduction-by-date rule, the flags,
 * the sample PayPro file, and who may open it.
 *
 *   npm run test:settlement
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parsePayproCsv } from '../lib/reconciliationCore'
import { deductionAmount, deductionProblem, deductionsInEffect, pkDay, settle, type Deduction, type OurPayment } from '../lib/settlementCore'
import { SCREEN_ACCESS, roleSatisfies } from '../lib/adminAccessCore'

const sample = parsePayproCsv(readFileSync(join(__dirname, 'fixtures', 'paypro-sample.csv'), 'utf8'))

// Our approved payments (approval instants in UTC; Pakistan is UTC+5).
const approved: OurPayment[] = [
  { ref: 'TM-20261004152320-9FEFF3', amountPkr: 199, approvedAt: '2026-10-04T15:24:03Z', method: null },
  { ref: 'TM-20261002150450-186C73', amountPkr: 199, approvedAt: '2026-10-02T15:06:02Z', method: null },
  // Approved at 20:00 UTC on 6 Oct = 01:00 on 7 Oct in Pakistan: OUTSIDE 1–6 Oct.
  { ref: 'TM-LATE', amountPkr: 199, approvedAt: '2026-10-06T20:00:00Z', method: null },
]

test('a payment belongs to its Pakistan-time day', () => {
  assert.equal(pkDay('2026-10-06T18:59:59Z'), '2026-10-06')
  assert.equal(pkDay('2026-10-06T19:00:00Z'), '2026-10-07')
})

test('the sample PayPro file: totals row skipped, MerchantShare of PAID orders in range', () => {
  assert.equal(sample.length, 5, 'five orders, the totals row skipped')
  const r = settle({ from: '2026-10-01', to: '2026-10-06', approved, gatewayRows: sample, transfers: [], deductions: [] })
  assert.equal(r.ourCount, 2)
  assert.equal(r.ourTotal, 398)
  assert.equal(r.gatewayCount, 3, 'three PAID orders dated 3–5 Oct')
  assert.equal(r.gatewayReported, 1549.09)
  // Flags, listed only.
  assert.deepEqual(r.paidNotApproved.map((f) => f.ref).sort(), ['TM-20261003181500-7B2C1E', 'TM-20261005105923-840E82'])
  assert.deepEqual(r.approvedNotPaid.map((f) => f.ref), ['TM-20261002150450-186C73'])
  assert.deepEqual(r.amountDifferences, [])
})

test('without a gateway file nothing is flagged as unpaid', () => {
  const r = settle({ from: '2026-10-01', to: '2026-10-06', approved, gatewayRows: null, transfers: [], deductions: [] })
  assert.equal(r.hasGatewayFile, false)
  assert.deepEqual(r.approvedNotPaid, [])
})

test('deductions use the line in effect on each payment’s date; a new rate never rewrites the past', () => {
  const lines: Deduction[] = [
    { id: 'a', name: 'PayPro fee', percent: 3, fixedPkr: null, effectiveFrom: '2026-09-01' },
    { id: 'b', name: 'PayPro fee', percent: 2, fixedPkr: null, effectiveFrom: '2026-10-03' },
    { id: 'c', name: 'Withholding tax', percent: null, fixedPkr: 5, effectiveFrom: '2026-10-01' },
  ]
  assert.deepEqual(deductionsInEffect('2026-10-02', lines).map((l) => l.id).sort(), ['a', 'c'])
  assert.deepEqual(deductionsInEffect('2026-10-04', lines).map((l) => l.id).sort(), ['b', 'c'])
  assert.equal(deductionAmount(lines[0], 199), 5.97)

  const r = settle({ from: '2026-10-01', to: '2026-10-06', approved, gatewayRows: null, transfers: [], deductions: lines })
  // 2 Oct payment at 3% = 5.97; 4 Oct payment at 2% = 3.98; tax 5 + 5.
  assert.deepEqual(r.deductionLines, [
    { name: 'PayPro fee', amount: 9.95 },
    { name: 'Withholding tax', amount: 10 },
  ])
  assert.equal(r.totalDeductions, 19.95)
  assert.equal(r.expectedInBank, 378.05)
})

test('difference = transfers − expected; negative is money missing', () => {
  const short = settle({
    from: '2026-10-01',
    to: '2026-10-06',
    approved,
    gatewayRows: null,
    transfers: [{ transferredOn: '2026-10-06', amountPkr: 300, reference: 'test', accountLast4: '1234' }, { transferredOn: '2026-10-08', amountPkr: 999, reference: null, accountLast4: null }],
    deductions: [],
  })
  assert.equal(short.transferCount, 1, 'a transfer outside the range is not counted')
  assert.equal(short.transfersReceived, 300)
  assert.equal(short.difference, -98)
  assert.equal(short.missing, true)
  const full = settle({ from: '2026-10-01', to: '2026-10-06', approved, gatewayRows: null, transfers: [{ transferredOn: '2026-10-05', amountPkr: 398, reference: null, accountLast4: null }], deductions: [] })
  assert.equal(full.difference, 0)
  assert.equal(full.missing, false)
})

test('a deduction line needs a name, and a percent or a fixed amount', () => {
  assert.match(deductionProblem({ name: '', percent: 2, fixedPkr: null, effectiveFrom: '2026-10-01' }) ?? '', /name/)
  assert.match(deductionProblem({ name: 'Fee', percent: null, fixedPkr: null, effectiveFrom: '2026-10-01' }) ?? '', /percentage/)
  assert.match(deductionProblem({ name: 'Fee', percent: 120, fixedPkr: null, effectiveFrom: '2026-10-01' }) ?? '', /between 0 and 100/)
  assert.equal(deductionProblem({ name: 'Fee', percent: 2.5, fixedPkr: 10, effectiveFrom: '2026-10-01' }), null)
})

test('the settlement check (and the old reconciliation) is owner only', () => {
  for (const key of ['paymentGateways', 'reconciliation', 'finance'] as const) {
    assert.equal(roleSatisfies('owner', SCREEN_ACCESS[key]), true)
    for (const r of ['admin', 'operations', 'tuitions_staff'] as const) assert.equal(roleSatisfies(r, SCREEN_ACCESS[key]), false, `${key} ${r}`)
  }
  const route = readFileSync(join(__dirname, '..', 'app', 'api', 'admin', 'payments', 'settlement', 'route.ts'), 'utf8')
  assert.ok(route.includes('checkAdminRole(...SCREEN_ACCESS.finance)'))
  const exp = readFileSync(join(__dirname, '..', 'app', 'api', 'admin', 'payments', 'settlement', 'export', 'route.ts'), 'utf8')
  assert.ok(exp.includes('checkAdminRole(...SCREEN_ACCESS.finance)'))
  const lib = readFileSync(join(__dirname, '..', 'lib', 'settlement.ts'), 'utf8')
  assert.ok(lib.includes(".select('provider_ref, amount_pkr, reviewed_at, updated_at, created_at, method, raw')"), 'payments are read by reference, amount, dates and method only')
  assert.ok(!/select\('[^']*(full_name|email|phone)/.test(lib), 'no personal column is selected')
  const old = readFileSync(join(__dirname, '..', 'app', 'admin', 'payments', 'reconciliation', 'page.tsx'), 'utf8')
  // Moved to Admin → Finance → Settlement check (owner, 8 Oct 2026).
  assert.ok(old.includes("permanentRedirect(`/admin/finance/settlement"), 'the old URL redirects')
})

// --- per settle date (owner, 8 Oct 2026) -----------------------------------
import { settleByDate } from '../lib/settlementCore'

const order = (n: number, share: number, settleDate: string | null, datePaid = '2026-10-05') => ({
  orderNumber: `TM-S${n}`,
  transactionStatus: 'PAID',
  paymentVia: 'JazzCash',
  orderAmount: 199,
  merchantShare: share,
  datePaid,
  settleDate,
  settleStatus: settleDate ? 'Settled' : null,
})

test('the owner sample: 5 JazzCash orders settled 6 Oct (Rs 1,000) vs the Rs 999 transfer of 5 Oct = matched, Re 1 bank charge', () => {
  const rows = [1, 2, 3, 4, 5].map((n) => order(n, 200, '2026-10-06'))
  const { groups } = settleByDate(rows, [{ transferredOn: '2026-10-05', amountPkr: 999, reference: null, accountLast4: null }], '2026-10-08T05:00:00Z')
  assert.equal(groups.length, 1)
  assert.equal(groups[0].merchantShare, 1000)
  assert.equal(groups[0].status, 'bank_charge')
  assert.equal(groups[0].bankCharge, 1)
})

test('more than Rs 2 short is missing; no transfer within 2 days is missing', () => {
  const rows = [order(1, 1000, '2026-10-06')]
  assert.equal(settleByDate(rows, [{ transferredOn: '2026-10-06', amountPkr: 990, reference: null, accountLast4: null }], '2026-10-08T05:00:00Z').groups[0].status, 'missing')
  assert.equal(settleByDate(rows, [{ transferredOn: '2026-10-10', amountPkr: 1000, reference: null, accountLast4: null }], '2026-10-11T05:00:00Z').groups[0].status, 'missing')
})

test('a transfer pays one settle-date group only; on/after wins a tie', () => {
  const rows = [order(1, 500, '2026-10-06'), order(2, 700, '2026-10-07')]
  const t = [
    { transferredOn: '2026-10-07', amountPkr: 700, reference: 'b', accountLast4: null },
    { transferredOn: '2026-10-06', amountPkr: 500, reference: 'a', accountLast4: null },
  ]
  const { groups } = settleByDate(rows, t, '2026-10-08T05:00:00Z')
  assert.equal(groups[0].transfer?.reference, 'a')
  assert.equal(groups[1].transfer?.reference, 'b')
  assert.ok(groups.every((g) => g.status === 'matched'))
})

test('PAID but not settled = Due from PayPro with its age; red (overdue) after 3 days', () => {
  const rows = [order(1, 200, null, '2026-10-06'), order(2, 200, null, '2026-10-02')]
  const { due } = settleByDate(rows, [], '2026-10-08T05:00:00Z')
  assert.deepEqual(due.map((d) => [d.orderNumber, d.ageDays, d.overdue]), [['TM-S2', 6, true], ['TM-S1', 2, false]])
})
