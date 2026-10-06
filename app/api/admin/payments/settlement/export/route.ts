import { NextResponse } from 'next/server'
import { Workbook } from 'exceljs'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { settlementExportRows } from '@/lib/settlement'
import { formatDateTime } from '@/lib/datetime'

// The TutorMint-side list for a settlement check, as .xlsx (owner, 6 Oct 2026).
// OWNER ONLY. Columns: date (Pakistan time), TM reference, amount, method if
// known. No member names, mobiles or emails — they are never read.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DAY = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.paymentGateways)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const url = new URL(request.url)
  const gateway = url.searchParams.get('gateway') ?? 'paypro'
  let from = url.searchParams.get('from') ?? ''
  let to = url.searchParams.get('to') ?? ''
  if (gateway !== 'paypro') return NextResponse.json({ error: 'That gateway is not connected.' }, { status: 400 })
  if (!DAY.test(from) || !DAY.test(to)) return NextResponse.json({ error: 'Choose a date range first.' }, { status: 400 })
  if (from > to) [from, to] = [to, from]

  const rows = await settlementExportRows(gateway, from, to)

  const wb = new Workbook()
  const ws = wb.addWorksheet('Payments')
  ws.columns = [
    { header: 'Date (Pakistan time)', key: 'date', width: 24 },
    { header: 'TM reference', key: 'ref', width: 30 },
    { header: 'Amount (Rs)', key: 'amount', width: 14 },
    { header: 'Method', key: 'method', width: 16 },
  ]
  for (const r of rows) ws.addRow({ date: formatDateTime(r.approvedAt), ref: r.ref, amount: r.amountPkr, method: r.method ?? '' })
  ws.addRow({})
  ws.addRow({ date: 'Total', ref: `${rows.length} payment${rows.length === 1 ? '' : 's'}`, amount: rows.reduce((s, r) => s + r.amountPkr, 0) })
  ws.getRow(1).font = { bold: true }

  const buf = await wb.xlsx.writeBuffer()
  return new NextResponse(Buffer.from(buf as ArrayBuffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="tutormint-${gateway}-payments-${from}-to-${to}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
}
