/**
 * scripts/test-paypro-export.ts — reading PayPro's real Orders export (owner,
 * 11 Oct 2026). The committed fixture copies the real file's structure exactly
 * (x: prefixes, BOM, absolute part paths, two sheets, 22 headers, mixed types, an
 * Excel-date Settle-Date, a totals row) with fake orders and no customer details.
 *
 *   npm run test:payproexport
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { Workbook } from 'exceljs'

import { readPayproExport, normalisePaymentVia } from '../lib/payproExport'
import { readXlsxSheets } from '../lib/xlsxRead'
import { isPaid } from '../lib/reconciliationCore'
import { isSettled } from '../lib/settlementCore'
import { buildBoard, payMethod, planUpsert } from '../lib/settlementMatchCore'
import { buildPayproWorkbook, FIXTURE_ROWS, orderRow, PAYPRO_HEADERS } from './fixtures/payproWorkbook'

const root = join(__dirname, '..')
const fixture = readFileSync(join(__dirname, 'fixtures', 'paypro-orders-export.xlsx'))

async function rows() {
  const r = await readPayproExport(fixture, 'order-11-10-2026.xlsx')
  if (!r.ok) throw new Error(r.error)
  return r
}

test('the fixture has the real structure: x: prefixes, a BOM, absolute paths, a table, two sheets, 22 headers', async () => {
  const zip = await JSZip.loadAsync(fixture)
  const wb = await zip.file('xl/workbook.xml')!.async('string')
  assert.equal(wb.charCodeAt(0), 0xfeff, 'the part starts with a BOM')
  assert.ok(wb.includes('<x:workbook') && wb.includes('<x:sheet name="Orders"') && wb.includes('<x:sheet name="Bill Detail 01"'))
  assert.ok((await zip.file('xl/_rels/workbook.xml.rels')!.async('string')).includes('Target="/xl/worksheets/sheet.xml"'))
  assert.ok(zip.file('xl/tables/table.xml') && zip.file('package/services/metadata/core-properties/fixture.psmdcp'))
  const sheet = await zip.file('xl/worksheets/sheet.xml')!.async('string')
  assert.ok(/<x:c r="S2" s="1"><x:v>\d+<\/x:v>/.test(sheet), 'Settle-Date is a real Excel date (style 1 = numFmtId 14)')
  assert.equal(PAYPRO_HEADERS.length, 22)
  // The committed file is what the builder makes.
  assert.deepEqual(await readXlsxSheets(fixture), await readXlsxSheets(await buildPayproWorkbook({ rows: FIXTURE_ROWS })), 'rebuild with: npx tsx scripts/fixtures/payproWorkbook.ts')
  // No customer details: placeholders only.
  const strings = await zip.file('xl/sharedStrings.xml')!.async('string')
  assert.ok(strings.includes('FIXTURE NAME') && strings.includes('fixture@example.invalid') && !/03\d{9}/.test(strings))
})

test('this is the file exceljs cannot read — the reason the upload failed', async () => {
  const wb = new Workbook()
  await assert.rejects(() => wb.xlsx.load(fixture as unknown as Parameters<typeof wb.xlsx.load>[0]), /sheets/)
})

test('parses the fixture: the Orders sheet, six orders, the totals row and Bill Detail ignored', async () => {
  const r = await rows()
  assert.equal(r.sheet, 'Orders')
  assert.equal(r.rows.length, 6, 'six orders; the totals row has no Order-Number')
  assert.deepEqual(r.rows.map((x) => x.orderNumber), FIXTURE_ROWS.slice(0, 6).map((x) => x[2]))
  assert.ok(!r.rows.some((x) => x.orderNumber === 'Total' || x.paymentVia === 'Total'))
  assert.deepEqual(r.rows.map((x) => x.transactionStatus), ['PAID', 'PAID', 'PAID', 'PAID', 'UNPAID', 'UNPAID'])
  // Both sheets are in the workbook; only Orders is used.
  const sheets = await readXlsxSheets(fixture)
  assert.deepEqual(sheets.map((s) => [s.name, s.rows.length]), [['Orders', 8], ['Bill Detail 01', 2]])
})

test('reads both amount types (number and numeric text) and an empty MerchantShare', async () => {
  const [a, b, , , unpaid, unpaidText] = (await rows()).rows
  assert.deepEqual([a.orderAmount, a.merchantShare], [199, 193], 'numbers')
  assert.deepEqual([b.orderAmount, b.merchantShare], [199, 193], 'text "199" / "193"')
  assert.deepEqual([unpaid.orderAmount, unpaid.merchantShare], [199, null])
  assert.deepEqual([unpaidText.orderAmount, unpaidText.merchantShare], [499, null])
})

test('reads both date types as the Pakistan calendar day: "dd-Mon-yyyy" text and a real Excel date', async () => {
  const [a, , , pending, unpaid] = (await rows()).rows
  assert.equal(a.datePaid, '2026-10-08', 'text "08-Oct-2026"')
  assert.equal(a.settleDate, '2026-10-09', 'Excel date, no day shift')
  assert.equal(a.settleStatus, 'Settled')
  assert.deepEqual([pending.datePaid, pending.settleDate, pending.settleStatus], ['2026-10-10', null, null])
  assert.deepEqual([unpaid.datePaid, unpaid.settleDate], [null, null])
  assert.equal(isSettled(a), true)
  assert.equal(isPaid(pending.transactionStatus) && !isSettled(pending), true, 'paid, not settled yet')
})

test('normalises Payment Via: EasyPaisa and Easypaisa are Easypaisa', async () => {
  const r = (await rows()).rows
  assert.equal(r[2].paymentVia, 'Easypaisa')
  assert.equal(payMethod(r[2].paymentVia), 'Easypaisa')
  assert.equal(r[0].paymentVia, 'JazzCash')
  for (const v of ['EasyPaisa', 'Easypaisa', 'easypaisa', 'Easy Paisa', ' EASYPAISA ']) assert.equal(normalisePaymentVia(v), 'Easypaisa', v)
  assert.equal(normalisePaymentVia('jazzcash'), 'JazzCash')
  assert.equal(normalisePaymentVia(''), null)
  assert.equal(normalisePaymentVia(null), null)
})

test('customer columns are never returned, and the importer stores none of them', async () => {
  const r = await rows()
  const text = JSON.stringify(r)
  for (const banned of ['FIXTURE NAME', '00000000000', 'fixture@example.invalid', 'CP-0000000', 'Fixture order']) assert.ok(!text.includes(banned), banned)
  assert.deepEqual(Object.keys(r.rows[0]).sort(), ['datePaid', 'merchantShare', 'orderAmount', 'orderNumber', 'paymentVia', 'settleDate', 'settleStatus', 'transactionStatus'])
  const lib = readFileSync(join(root, 'lib', 'reconciliation.ts'), 'utf8')
  assert.ok(lib.includes('readPayproExport(buffer, filename)') && !lib.includes("from 'exceljs'"))
  assert.ok(!/customer/i.test(lib.slice(lib.indexOf('const record ='), lib.indexOf('const FAILED'))), 'no customer field in the stored record')
})

test('a missing column is named; the sheet is found by name in any case, else by its header', async () => {
  const dataRows = FIXTURE_ROWS.slice(0, 2)
  const drop = (name: string) => {
    const i = PAYPRO_HEADERS.indexOf(name)
    return { headers: PAYPRO_HEADERS.filter((_, k) => k !== i), rows: dataRows.map((r) => r.filter((_, k) => k !== i)) }
  }
  const noSettle = await readPayproExport(await buildPayproWorkbook(drop('Settle-Date')), 'x.xlsx')
  assert.equal(noSettle.ok, false)
  assert.match(noSettle.ok ? '' : noSettle.error, /^Missing column: Settle-Date\./)
  const two = drop('MerchantShare')
  const i = two.headers.indexOf('Date Paid')
  const noTwo = await readPayproExport(await buildPayproWorkbook({ headers: two.headers.filter((_, k) => k !== i), rows: two.rows.map((r) => r.filter((_, k) => k !== i)) }), 'x.xlsx')
  assert.match(noTwo.ok ? '' : noTwo.error, /^Missing column: MerchantShare, Date Paid\./)
  const noOrder = await readPayproExport(await buildPayproWorkbook(drop('Order-Number')), 'x.xlsx')
  assert.match(noOrder.ok ? '' : noOrder.error, /^Missing column: Order-Number\./)

  // Headers match whatever the case or spacing.
  const loose = await readPayproExport(await buildPayproWorkbook({ headers: PAYPRO_HEADERS.map((h) => h.toUpperCase().replace(/-/g, ' ')), rows: dataRows }), 'x.xlsx')
  assert.equal(loose.ok && loose.rows.length, 2)
  // "ORDERS" is the Orders sheet; a sheet with another name is found by its header, even when it is second.
  const upper = await readPayproExport(await buildPayproWorkbook({ ordersName: 'ORDERS', rows: dataRows }), 'x.xlsx')
  assert.equal(upper.ok && upper.sheet, 'ORDERS')
  const other = await readPayproExport(await buildPayproWorkbook({ ordersName: 'Report', ordersSecond: true, rows: dataRows }), 'x.xlsx')
  assert.equal(other.ok && other.sheet, 'Report')
  assert.equal(other.ok && other.rows.length, 2)

  // Not a workbook at all: the plain message.
  const junk = await readPayproExport(Buffer.from('not a zip'), 'x.xlsx')
  assert.match(junk.ok ? '' : junk.error, /could not read that file/)
})

test('the same report as .csv reads the same orders (BOM, 22 columns, text dates, totals row)', async () => {
  const q = (v: unknown) => (v === null ? '' : typeof v === 'object' ? '09-Oct-2026' : /[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const csv = '﻿' + [PAYPRO_HEADERS, ...FIXTURE_ROWS].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n'
  const fromCsv = await readPayproExport(Buffer.from(csv, 'utf8'), 'order-11-10-2026.csv')
  assert.equal(fromCsv.ok, true)
  assert.deepEqual(fromCsv.ok && fromCsv.rows, (await rows()).rows)
  const bad = await readPayproExport(Buffer.from('Order-Number,Transaction Status\nTM-1,PAID\n'), 'x.csv')
  assert.match(bad.ok ? '' : bad.error, /^Missing column: Payment Via, Order-Amount, MerchantShare, Date Paid, Settle-Date, Settle-Status\./)
})

test('an ordinary Excel-saved workbook (no prefixes) still reads', async () => {
  const wb = new Workbook()
  const ws = wb.addWorksheet('Orders')
  ws.addRow(['Order-Number', 'Transaction Status', 'Payment Via', 'Order-Amount', 'MerchantShare', 'Date Paid', 'Settle-Date', 'Settle-Status'])
  ws.addRow(['TM-PLAIN-1', 'PAID', 'JazzCash', 199, 193, '08-Oct-2026', new Date(Date.UTC(2026, 9, 9)), 'Settled'])
  ws.getCell('G2').numFmt = 'mm-dd-yy'
  const r = await readPayproExport(Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer), 'plain.xlsx')
  assert.equal(r.ok, true, r.ok ? '' : r.error)
  assert.deepEqual(r.ok && r.rows[0], {
    orderNumber: 'TM-PLAIN-1', transactionStatus: 'PAID', paymentVia: 'JazzCash', orderAmount: 199, merchantShare: 193,
    datePaid: '2026-10-08', settleDate: '2026-10-09', settleStatus: 'Settled',
  })
})

test('re-uploading the export does not duplicate, and its orders match a bank credit', async () => {
  const file = (await rows()).rows
  const first = planUpsert(file, [], [])
  assert.equal(first.newOrders.length, 6)
  const again = planUpsert(file, first.rows.map((r) => r.orderNumber), [])
  assert.deepEqual([again.newOrders.length, again.updatedOrders.length], [0, 6])

  // The two JazzCash orders settled 9 Oct (193 + 193) are one Rs 386 credit.
  const b = buildBoard({
    rows: file,
    credits: [{ id: 'c1', date: '2026-10-09', time: null, amountPkr: 386, senderName: 'PAYPRO PRIVATE LIMITED', senderBank: null, reference: 'FT1', note: null, isPaypro: true }],
    ourPaypro: [],
    receipts: [],
    links: [],
    nowIso: '2026-10-11T06:00:00Z',
  })
  assert.equal(b.matches[0].status, 'matched')
  assert.deepEqual(b.matches[0].orders, ['TM-20261008101500-FIX001', 'TM-20261008113000-FIX002'])
})
