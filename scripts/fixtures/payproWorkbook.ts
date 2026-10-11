/**
 * scripts/fixtures/payproWorkbook.ts — builds an .xlsx with the EXACT structure
 * of PayPro's Orders export (owner, 11 Oct 2026), for tests. It copies what
 * their .NET OpenXML writer produces and what broke our first reader:
 *   • every spreadsheet tag carries the "x:" namespace prefix
 *   • every part starts with a UTF-8 BOM
 *   • part paths in the relationships are absolute ("/xl/worksheets/sheet.xml")
 *   • an Excel Table under xl/tables, and package/services/metadata core properties
 *   • two sheets: "Orders" (22 headers) and "Bill Detail 01" (a header + an empty row)
 *   • text in shared strings; amounts as numbers in some rows and text in others;
 *     Date Paid as text ("08-Oct-2026"); Settle-Date as a real Excel date (style 1,
 *     numFmtId 14); a totals row with no Order-Number
 * Order numbers are fake and there are NO customer details — the customer
 * columns exist (as in the real file) and hold obvious placeholders only.
 *
 *   npx tsx scripts/fixtures/payproWorkbook.ts     # rewrites paypro-orders-export.xlsx
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'

export const PAYPRO_HEADERS = [
  'Consumer ID', 'ConnectPay Id', 'Order-Number', 'Transaction Status', 'Payment Mode', 'Payment Via', 'Payment Bank', 'Order-Amount',
  'MerchantShare', 'Order-Duedate', 'Issue-Date', 'Date Paid', 'Customer-Name', 'Customer-Mobile', 'Customer-Email', 'Customer-Address',
  'Customer-Bank', 'Reason', 'Settle-Date', 'Settle-Status', 'ReasonDescription', 'Ecommerce_return_url',
]

/** A cell: text (shared string), a number, or an Excel date (ISO day). Null = no cell. */
export type FixtureCell = string | number | { date: string } | null

const BOM = '﻿'
const HEAD = `${BOM}<?xml version="1.0" encoding="utf-8"?>`
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function colName(i: number): string {
  let n = i + 1
  let s = ''
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** ISO day → Excel serial (1900 date system). */
export function excelSerial(isoDay: string): number {
  return Math.round(Date.parse(`${isoDay}T00:00:00Z`) / 86_400_000) + 25569
}

export async function buildPayproWorkbook(input: {
  /** Sheet 1's name ("Orders" in the real file). */
  ordersName?: string
  headers?: string[]
  rows: FixtureCell[][]
  /** Put the data sheet second and the bill sheet first. */
  ordersSecond?: boolean
}): Promise<Buffer> {
  const headers = input.headers ?? PAYPRO_HEADERS
  const strings: string[] = []
  const sst = (s: string) => {
    let i = strings.indexOf(s)
    if (i < 0) i = strings.push(s) - 1
    return i
  }
  const sheetXml = (table: FixtureCell[][], rid: string, emptyLastRow = false) => {
    const width = Math.max(...table.map((r) => r.length))
    const rows = table
      .map((cells, r) => {
        const body = cells
          .map((c, i) => {
            if (c === null) return ''
            const ref = `${colName(i)}${r + 1}`
            if (typeof c === 'string') return `<x:c r="${ref}" s="0" t="s"><x:v>${sst(c)}</x:v></x:c>`
            if (typeof c === 'number') return `<x:c r="${ref}" s="0" t="n"><x:v>${c}</x:v></x:c>`
            return `<x:c r="${ref}" s="1"><x:v>${excelSerial(c.date)}</x:v></x:c>`
          })
          .join('')
        return `<x:row r="${r + 1}" spans="1:${width}">${body}</x:row>`
      })
      .join('')
    const last = emptyLastRow ? `<x:row r="${table.length + 1}" spans="1:${width}" />` : ''
    return (
      `${HEAD}<x:worksheet xmlns:r="${REL}" xmlns:x="${MAIN}"><x:sheetPr><x:outlinePr summaryBelow="1" summaryRight="1" /></x:sheetPr>` +
      `<x:dimension ref="A1:${colName(width - 1)}${table.length + (emptyLastRow ? 1 : 0)}" /><x:sheetViews><x:sheetView workbookViewId="0" /></x:sheetViews>` +
      `<x:sheetFormatPr defaultRowHeight="15" /><x:sheetData>${rows}${last}</x:sheetData>` +
      `<x:pageMargins left="0.75" right="0.75" top="0.75" bottom="0.5" header="0.5" footer="0.75" /><x:headerFooter />` +
      `<x:tableParts count="1"><x:tablePart r:id="${rid}" /></x:tableParts></x:worksheet>`
    )
  }
  const tableXml = (id: number, cols: string[], rowCount: number) =>
    `${HEAD}<x:table id="${id}" name="Table${id}" displayName="Table${id}" ref="A1:${colName(cols.length - 1)}${rowCount}" totalsRowShown="0" xmlns:x="${MAIN}">` +
    `<x:tableColumns count="${cols.length}">${cols.map((c, i) => `<x:tableColumn id="${i + 1}" name="${esc(c)}" />`).join('')}</x:tableColumns></x:table>`
  const rels = (items: [string, string, string][]) =>
    `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    items.map(([type, target, id]) => `<Relationship Type="${type}" Target="${target}" Id="${id}" />`).join('') +
    `</Relationships>`

  const billHeaders = ['Bill Detail', 'Amount', 'Tax', 'Charges', 'Total']
  const orders = sheetXml([headers, ...input.rows], 'rId6')
  const bill = sheetXml([billHeaders], 'rId7', true)
  const [first, second] = input.ordersSecond ? [bill, orders] : [orders, bill]
  const ordersName = input.ordersName ?? 'Orders'
  const [name1, name2] = input.ordersSecond ? ['Bill Detail 01', ordersName] : [ordersName, 'Bill Detail 01']
  const [table1, table2] = input.ordersSecond
    ? [tableXml(1, billHeaders, 2), tableXml(2, headers, input.rows.length + 1)]
    : [tableXml(1, headers, input.rows.length + 1), tableXml(2, billHeaders, 2)]

  const xf = (numFmtId: number) =>
    `<x:xf numFmtId="${numFmtId}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="0" applyAlignment="1" applyProtection="1">` +
    `<x:alignment horizontal="general" vertical="bottom" /><x:protection locked="1" hidden="0" /></x:xf>`

  const files: [string, string][] = [
    [
      'xl/workbook.xml',
      `${HEAD}<x:workbook xmlns:r="${REL}" xmlns:x="${MAIN}"><x:workbookPr codeName="ThisWorkbook" /><x:bookViews><x:workbookView firstSheet="0" activeTab="0" /></x:bookViews>` +
        `<x:sheets><x:sheet name="${esc(name1)}" sheetId="2" r:id="rId2" /><x:sheet name="${esc(name2)}" sheetId="3" r:id="rId3" /></x:sheets><x:definedNames /><x:calcPr calcId="125725" /></x:workbook>`,
    ],
    [
      '_rels/.rels',
      rels([
        [`${REL}/officeDocument`, '/xl/workbook.xml', 'R22cff5ae9a1c4e76'],
        [`${REL}/extended-properties`, '/docProps/app.xml', 'rId1'],
        ['http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', '/package/services/metadata/core-properties/fixture.psmdcp', 'R05b04549597c4cb0'],
      ]),
    ],
    ['docProps/app.xml', `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>`],
    ['xl/worksheets/sheet.xml', first],
    ['xl/worksheets/sheet2.xml', second],
    // sharedStrings is written after the sheets have registered their strings.
    [
      'xl/sharedStrings.xml',
      `${HEAD}<x:sst count="${strings.length}" uniqueCount="${strings.length}" xmlns:x="${MAIN}">${strings.map((s) => `<x:si><x:t>${esc(s)}</x:t></x:si>`).join('')}</x:sst>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      rels([
        [`${REL}/sharedStrings`, '/xl/sharedStrings.xml', 'rId4'],
        [`${REL}/styles`, '/xl/styles.xml', 'rId5'],
        [`${REL}/worksheet`, '/xl/worksheets/sheet.xml', 'rId2'],
        [`${REL}/worksheet`, '/xl/worksheets/sheet2.xml', 'rId3'],
        [`${REL}/theme`, '/xl/theme/theme.xml', 'rId9'],
      ]),
    ],
    [
      'xl/styles.xml',
      `${HEAD}<x:styleSheet xmlns:x="${MAIN}"><x:numFmts count="1"><x:numFmt numFmtId="0" formatCode="" /></x:numFmts>` +
        `<x:fonts count="1"><x:font><x:sz val="11" /><x:name val="Calibri" /></x:font></x:fonts>` +
        `<x:fills count="1"><x:fill><x:patternFill patternType="none" /></x:fill></x:fills><x:borders count="1"><x:border /></x:borders>` +
        `<x:cellStyleXfs count="2">${xf(0)}${xf(14)}</x:cellStyleXfs><x:cellXfs count="2">${xf(0)}${xf(14)}</x:cellXfs>` +
        `<x:cellStyles count="1"><x:cellStyle name="Normal" xfId="0" builtinId="0" /></x:cellStyles></x:styleSheet>`,
    ],
    ['xl/tables/table.xml', table1],
    ['xl/worksheets/_rels/sheet.xml.rels', rels([[`${REL}/table`, '/xl/tables/table.xml', input.ordersSecond ? 'rId7' : 'rId6']])],
    ['xl/tables/table2.xml', table2],
    ['xl/worksheets/_rels/sheet2.xml.rels', rels([[`${REL}/table`, '/xl/tables/table2.xml', input.ordersSecond ? 'rId6' : 'rId7']])],
    ['xl/theme/theme.xml', `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme" />`],
    [
      'package/services/metadata/core-properties/fixture.psmdcp',
      `${HEAD}<coreProperties xmlns="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" />`,
    ],
    [
      '[Content_Types].xml',
      `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" />` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />` +
        `<Default Extension="psmdcp" ContentType="application/vnd.openxmlformats-package.core-properties+xml" />` +
        `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml" />` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml" />` +
        `<Override PartName="/xl/worksheets/sheet.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" />` +
        `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" />` +
        `<Override PartName="/xl/tables/table.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml" />` +
        `<Override PartName="/xl/tables/table2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml" />` +
        `</Types>`,
    ],
  ]

  const zip = new JSZip()
  // A fixed timestamp, so building the fixture twice gives the same bytes.
  const date = new Date('2026-10-11T00:00:00Z')
  for (const [name, text] of files) zip.file(name, text, { date })
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/** One order row in the 22-column layout. Customer columns hold placeholders. */
export function orderRow(o: {
  order: string | null
  status?: string | null
  via?: string | null
  bank?: string | null
  amount?: number | string | null
  share?: number | string | null
  paid?: string | null
  settle?: string | null
  settleStatus?: string | null
}): FixtureCell[] {
  const isOrder = o.order !== null
  return [
    null,
    isOrder ? 'CP-0000000' : null,
    o.order,
    o.status ?? null,
    null,
    o.via ?? null,
    o.bank ?? null,
    o.amount ?? null,
    o.share ?? null,
    isOrder ? '31-Oct-2026' : null,
    isOrder ? '01-Oct-2026' : null,
    o.paid ?? null,
    isOrder ? 'FIXTURE NAME' : null,
    isOrder ? '00000000000' : null,
    isOrder ? 'fixture@example.invalid' : null,
    null,
    null,
    null,
    o.settle ? { date: o.settle } : null,
    o.settleStatus ?? null,
    isOrder ? 'Fixture order' : null,
    null,
  ]
}

/** The committed fixture: six orders and the totals row. */
export const FIXTURE_ROWS: FixtureCell[][] = [
  orderRow({ order: 'TM-20261008101500-FIX001', status: 'PAID', via: 'JazzCash', amount: 199, share: 193, paid: '08-Oct-2026', settle: '2026-10-09', settleStatus: 'Settled' }),
  // Amounts as TEXT, as some rows of the real file have them.
  orderRow({ order: 'TM-20261008113000-FIX002', status: 'PAID', via: 'JazzCash', amount: '199', share: '193', paid: '08-Oct-2026', settle: '2026-10-09', settleStatus: 'Settled' }),
  orderRow({ order: 'TM-20261008150000-FIX003', status: 'PAID', via: 'EasyPaisa', amount: 199, share: 203, paid: '08-Oct-2026', settle: '2026-10-09', settleStatus: 'Settled' }),
  // Paid, not settled: no Settle-Date cell, no Settle-Status.
  orderRow({ order: 'TM-20261010090000-FIX004', status: 'PAID', via: 'JazzCash', amount: 199, share: 193, paid: '10-Oct-2026' }),
  // UNPAID: no Payment Via, no MerchantShare, no dates.
  orderRow({ order: 'TM-20261010093000-FIX005', status: 'UNPAID', amount: 199 }),
  orderRow({ order: 'TM-20261010100000-FIX006', status: 'UNPAID', amount: '499' }),
  // The totals row: no Order-Number, "Total" in Payment Bank.
  orderRow({ order: null, bank: 'Total', amount: 1494, share: 782 }),
]

if (require.main === module) {
  buildPayproWorkbook({ rows: FIXTURE_ROWS }).then((buf) => {
    const out = join(__dirname, 'paypro-orders-export.xlsx')
    writeFileSync(out, buf)
    console.log(`wrote ${out} (${buf.length} bytes)`)
  })
}
