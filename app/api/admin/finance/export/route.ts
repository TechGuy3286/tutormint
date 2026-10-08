import { NextResponse } from 'next/server'
import { Workbook } from 'exceljs'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadFinancePayments } from '@/lib/finance'
import { classify, inDayRange, typeLabel } from '@/lib/financeCore'
import { formatDateTime } from '@/lib/datetime'

// Admin → Finance download (owner, 8 Oct 2026, item 4). OWNER ONLY plus the
// view-only Partner (a GET, so a Partner may download it). Every approved
// payment in the range, Pakistan time. NO member contact details: no name,
// mobile or email is read for this file.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DAY = /^\d{4}-\d{2}-\d{2}$/

const STATUS_WORD = { counted: 'Counted', refunded: 'Refunded (not in totals)', deleted: 'Deleted account (not in totals)' } as const

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.finance)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const url = new URL(request.url)
  let from = url.searchParams.get('from') ?? ''
  let to = url.searchParams.get('to') ?? ''
  if (!DAY.test(from) || !DAY.test(to)) return NextResponse.json({ error: 'Choose a date range first.' }, { status: 400 })
  if (from > to) [from, to] = [to, from]

  const rows = inDayRange(await loadFinancePayments(), from, to)

  const wb = new Workbook()
  const ws = wb.addWorksheet('Payments')
  ws.columns = [
    { header: 'Approved (Pakistan time)', key: 'date', width: 24 },
    { header: 'TM reference', key: 'ref', width: 30 },
    { header: 'Type', key: 'type', width: 24 },
    { header: 'Method', key: 'method', width: 16 },
    { header: 'Amount (Rs)', key: 'amount', width: 14 },
    { header: 'Refunded (Rs)', key: 'refunded', width: 14 },
    { header: 'Status', key: 'status', width: 32 },
  ]
  for (const p of rows) {
    ws.addRow({
      date: formatDateTime(p.approvedAt),
      ref: p.ref ?? p.id,
      type: typeLabel(p.planCode, p.audience),
      method: p.method,
      amount: p.amountPkr,
      refunded: p.refundedAmountPkr ?? 0,
      status: STATUS_WORD[classify(p)],
    })
  }
  const counted = rows.filter((p) => classify(p) === 'counted')
  ws.addRow({})
  ws.addRow({
    date: 'Total counted',
    ref: `${counted.length} payment${counted.length === 1 ? '' : 's'}`,
    amount: counted.reduce((s, p) => s + p.amountPkr, 0),
  })
  ws.getRow(1).font = { bold: true }

  const buf = await wb.xlsx.writeBuffer()
  return new NextResponse(Buffer.from(buf as ArrayBuffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="tutormint-finance-${from}-to-${to}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
}
