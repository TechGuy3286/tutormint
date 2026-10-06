import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  accountLast4,
  excelSerialToIso,
  isPaid,
  matchRows,
  parseAmount,
  parseBankCsv,
  parseDate,
  parsePayproCsv,
  rowsFromSheet,
  summarise,
  type PayproRow,
} from '../lib/reconciliationCore'

// owner, 6 Oct 2026 — PayPro reconciliation. The pure core: reading the export,
// matching it with our payments, summing what PayPro owes and what the bank got.

const SAMPLE = readFileSync(join(__dirname, 'fixtures', 'paypro-sample.csv'), 'utf8')

// Two of the sample's order numbers are REAL production provider_refs (read
// with a read-only SELECT of provider_ref/amount/status only): one approved,
// one pending. The rest are made up in the same shape.
const payments = [
  { providerRef: 'TM-20261004152320-9FEFF3', status: 'approved', amountPkr: 199 },
  { providerRef: 'TM-20261005105923-840E82', status: 'pending', amountPkr: 199 },
  { providerRef: 'TM-20261002075312-C3AAD5', status: 'pending', amountPkr: 199 },
  { providerRef: 'TM-20261003181500-7B2C1E', status: 'approved', amountPkr: 999 }, // amount differs from the file
  { providerRef: 'TM-20260930120000-ZZ9999', status: 'approved', amountPkr: 199 }, // not in the file
]

test('the eight PayPro headers map by name, whatever the case or spacing', () => {
  const rows = rowsFromSheet([
    ['Some title line PayPro puts first'],
    ['ORDER NUMBER', 'transaction status', 'Payment  Via', 'Order Amount', 'Merchant Share', 'date paid', 'settle date', 'Settle Status', 'Customer Email'],
    ['TM-1', 'PAID', 'Card', '199', '193.03', '2026-10-04', '2026-10-06', 'Settled', 'someone@example.com'],
  ])
  assert.equal(rows.length, 1)
  const r = rows[0]
  assert.equal(r.orderNumber, 'TM-1')
  assert.equal(r.transactionStatus, 'PAID')
  assert.equal(r.paymentVia, 'Card')
  assert.equal(r.orderAmount, 199)
  assert.equal(r.merchantShare, 193.03)
  assert.equal(r.datePaid, '2026-10-04')
  assert.equal(r.settleDate, '2026-10-06')
  assert.equal(r.settleStatus, 'Settled')
  // Nothing outside the eight columns survives the parser.
  assert.deepEqual(Object.keys(r).sort(), [
    'datePaid', 'merchantShare', 'orderAmount', 'orderNumber', 'paymentVia', 'settleDate', 'settleStatus', 'transactionStatus',
  ])
  // A sheet with no Order-Number header is not a PayPro export.
  assert.deepEqual(rowsFromSheet([['Name', 'Amount'], ['x', '1']]), [])
})

test('the sample reads five orders and skips the totals row', () => {
  const rows = parsePayproCsv(SAMPLE)
  assert.equal(rows.length, 5)
  assert.ok(rows.every((r) => r.orderNumber.startsWith('TM-')))
  // The totals row carried amounts but no Order-Number.
  assert.ok(!rows.some((r) => r.orderAmount === 2096))
})

test('amounts: commas, currency, quotes and brackets', () => {
  assert.equal(parseAmount('Rs 1,199.00'), 1199)
  assert.equal(parseAmount('PKR 199'), 199)
  assert.equal(parseAmount('"1,199"'.replace(/"/g, '')), 1199)
  assert.equal(parseAmount(199), 199)
  assert.equal(parseAmount('(50)'), -50)
  assert.equal(parseAmount(''), null)
  assert.equal(parseAmount('n/a'), null)
  const rows = parsePayproCsv(SAMPLE)
  assert.equal(rows.find((r) => r.orderNumber.endsWith('840E82'))?.orderAmount, 199) // "Rs 199"
  assert.equal(rows.find((r) => r.orderNumber.endsWith('7B2C1E'))?.orderAmount, 1199) // "1,199"
})

test('dates: ISO, day-first, unambiguous month-first, month names, Excel serials', () => {
  assert.equal(parseDate('2026-10-04'), '2026-10-04')
  assert.equal(parseDate('2026-10-04 15:23:20'), '2026-10-04')
  assert.equal(parseDate('04/10/2026'), '2026-10-04') // day first
  assert.equal(parseDate('04-10-2026'), '2026-10-04')
  assert.equal(parseDate('10/25/2026'), '2026-10-25') // only reading that works: month first
  assert.equal(parseDate('25/10/2026'), '2026-10-25')
  assert.equal(parseDate('03/04/2026'), '2026-04-03') // ambiguous → day first, never guessed the other way
  assert.equal(parseDate('04-Oct-2026'), '2026-10-04')
  assert.equal(parseDate('Oct 4, 2026'), '2026-10-04')
  assert.equal(excelSerialToIso(46024), '2026-01-02')
  assert.equal(parseDate(46024), '2026-01-02')
  assert.equal(parseDate(new Date('2026-10-04T10:00:00Z')), '2026-10-04')
  assert.equal(parseDate('31/02/2026'), null)
  assert.equal(parseDate('yesterday'), null)
  assert.equal(parseDate(''), null)
  const rows = parsePayproCsv(SAMPLE)
  assert.equal(rows.find((r) => r.orderNumber.endsWith('7B2C1E'))?.datePaid, '2026-10-03') // 03-10-2026
  assert.equal(rows.find((r) => r.orderNumber.endsWith('9FEFF3'))?.settleDate, '2026-10-06') // 06/10/2026
  assert.equal(rows.find((r) => r.orderNumber.endsWith('C3AAD5'))?.datePaid, null)
})

test('isPaid: PAID in any case, SUCCESS too, nothing else', () => {
  assert.equal(isPaid('PAID'), true)
  assert.equal(isPaid('Paid'), true)
  assert.equal(isPaid(' paid '), true)
  assert.equal(isPaid('SUCCESS'), true)
  assert.equal(isPaid('UNPAID'), false)
  assert.equal(isPaid('FAILED'), false)
  assert.equal(isPaid('Pending'), false)
  assert.equal(isPaid(null), false)
  assert.equal(isPaid(undefined), false)
})

test('matchRows raises all three flags and counts the agreeing orders', () => {
  const rows = parsePayproCsv(SAMPLE)
  const m = matchRows(rows, payments)

  // PAID at PayPro, not approved here: the pending real ref.
  assert.deepEqual(m.paidNotApproved.map((f) => f.orderNumber), ['TM-20261005105923-840E82'])
  assert.equal(m.paidNotApproved[0].ourStatus, 'pending')
  assert.equal(m.paidNotApproved[0].payproStatus, 'PAID')

  // Approved here, not PAID there: the one missing from the file.
  assert.deepEqual(m.approvedNotPaid.map((f) => f.orderNumber), ['TM-20260930120000-ZZ9999'])
  assert.equal(m.approvedNotPaid[0].payproStatus, null) // "not in file"

  // Amounts differ: file says 1,199, we say 999.
  assert.deepEqual(m.amountDifferences.map((f) => f.orderNumber), ['TM-20261003181500-7B2C1E'])
  assert.equal(m.amountDifferences[0].orderAmount, 1199)
  assert.equal(m.amountDifferences[0].amountPkr, 999)

  // Fully agreeing: the approved real ref.
  assert.deepEqual(m.matched.map((f) => f.orderNumber), ['TM-20261004152320-9FEFF3'])
})

test('matching is trimmed and case-insensitive; a PAID line is reported when we have no row at all', () => {
  const rows: PayproRow[] = [
    { orderNumber: ' tm-abc ', transactionStatus: 'PAID', paymentVia: null, orderAmount: 199, merchantShare: 190, datePaid: '2026-10-01', settleDate: null, settleStatus: null },
    { orderNumber: 'TM-NEW', transactionStatus: 'PAID', paymentVia: null, orderAmount: 499, merchantShare: 480, datePaid: '2026-10-02', settleDate: null, settleStatus: null },
  ]
  const m = matchRows(rows, [{ providerRef: 'TM-ABC', status: 'approved', amountPkr: 199 }])
  assert.equal(m.matched.length, 1)
  assert.deepEqual(m.paidNotApproved.map((f) => [f.orderNumber, f.ourStatus]), [['TM-NEW', null]])
  assert.equal(m.approvedNotPaid.length, 0)
})

test('summarise: collected, expected, transfers, owed, and per-settlement cover', () => {
  const rows = parsePayproCsv(SAMPLE)
  const transfers = [
    { transferredOn: '2026-10-06', amountPkr: 1000, reference: 'PAYPRO SETTLEMENT', accountLast4: '4821' },
    { transferredOn: '2026-09-29', amountPkr: 5000, reference: 'last month', accountLast4: '4821' },
  ]
  const s = summarise(rows, transfers, { from: '2026-10-01', to: '2026-10-31' })
  // PAID in October: 199 + 199 + 1199 (FAILED and UNPAID do not count).
  assert.equal(s.collected, 1597)
  assert.equal(s.expected, 193.03 + 193.03 + 1163.03)
  assert.equal(s.paidCount, 3)
  assert.equal(s.transfersReceived, 1000) // the September transfer is outside the period
  assert.equal(s.transferCount, 1)
  assert.equal(s.owed, Math.round((s.expected - 1000) * 100) / 100)
  assert.ok(s.owed > 0)

  // Two orders settle on 6 Oct for 193.03 + 1163.03 = 1356.06; the bank got 1000 that day → not covered.
  assert.equal(s.settlementMatches.length, 2)
  assert.ok(s.settlementMatches.every((x) => x.settleDate === '2026-10-06' && x.shareThatDay === 1356.06 && x.transferredThatDay === 1000 && !x.covered))

  // Add the rest and both read as covered; owed turns negative-or-zero.
  const s2 = summarise(rows, [...transfers, { transferredOn: '2026-10-06', amountPkr: 356.06, reference: null, accountLast4: null }], { from: '2026-10-01', to: '2026-10-31' })
  assert.ok(s2.settlementMatches.every((x) => x.covered))
  assert.equal(s2.transfersReceived, 1356.06)

  // A period with no paid orders sums to zero rather than throwing.
  const empty = summarise(rows, transfers, { from: '2025-01-01', to: '2025-01-31' })
  assert.equal(empty.collected, 0)
  assert.equal(empty.owed, 0)
})

test('parseBankCsv finds the columns by name and keeps only the last 4 account digits', () => {
  const csv = [
    'Account Statement — HBL',
    'Value Date,Description,Debit,Credit,Balance,Account Number',
    '04/10/2026,PAYPRO SETTLEMENT 123,,"1,356.06","50,000",PK36HABB0012345678904821',
    '05/10/2026,ATM WITHDRAWAL,2000,,"48,000",PK36HABB0012345678904821',
    '06/10/2026,PAYPRO SETTLEMENT 124,,500,"48,500",0012-3456-7890-4821',
    ',,,,,',
  ].join('\n')
  const t = parseBankCsv(csv)
  assert.equal(t.length, 2) // the debit line and the blank line are skipped
  assert.deepEqual(t[0], { transferredOn: '2026-10-04', amountPkr: 1356.06, reference: 'PAYPRO SETTLEMENT 123', accountLast4: '4821' })
  assert.equal(t[1].amountPkr, 500)
  assert.equal(t[1].accountLast4, '4821')
  assert.equal(accountLast4('PK36HABB0012345678904821'), '4821')
  assert.equal(accountLast4('12'), null)
  assert.equal(accountLast4(''), null)
  // Plain "Date, Amount, Reference" works too.
  const plain = parseBankCsv('Date,Amount,Reference\n2026-10-06,1000,PayPro\nno date here,5,x\n')
  assert.deepEqual(plain, [{ transferredOn: '2026-10-06', amountPkr: 1000, reference: 'PayPro', accountLast4: null }])
  assert.deepEqual(parseBankCsv('nothing,here\n1,2'), [])
})
