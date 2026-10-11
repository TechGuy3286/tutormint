import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadSettlementsBoard } from '@/lib/settlementMatch'
import { monthCsv } from '@/lib/settlementMatchCore'

// Settlements → the chosen month as CSV (owner, 11 Oct 2026). OWNER ONLY, plus
// the view-only Partner (a download is a read). PayPro orders, approved bank
// transfers and bank credits with their status. No member names, mobiles or
// emails.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.finance)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const month = new URL(request.url).searchParams.get('month') ?? ''
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: 'Choose a month first.' }, { status: 400 })

  const board = await loadSettlementsBoard(month)
  if (!board) return NextResponse.json({ error: 'This is not working right now. Please try again in a few minutes.' }, { status: 500 })

  // A BOM so Excel opens it as UTF-8.
  return new NextResponse('﻿' + monthCsv(board.view), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tutormint-settlements-${month}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
