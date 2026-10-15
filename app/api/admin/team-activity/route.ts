import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadStaffActivity } from '@/lib/staffActivity'
import { loadSignupBoard } from '@/lib/staffSignups'
import { parsePeriod } from '@/lib/staffSignupsCore'
import { loadTuitionPosting } from '@/lib/tuitionPosting'
import {
  DEFAULT_TAB,
  isTeamTab,
  mayOpenTab,
  sortVerificationRows,
  verificationCounts,
  verificationTotal,
} from '@/lib/teamActivityCore'

// The numbers behind Tuitions → Team activity (owner, 15 Oct 2026), read only.
//   GET ?tab=paid|posted|verifications&period=today|yesterday|last7|month
// The page and this route read the same rule (lib/teamActivityCore mayOpenTab):
// "verifications" answers 403 to Operations and Tuitions staff; "paid" returns
// only the caller's own row unless they see everyone. Counts only — no amounts,
// no mobiles.

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.tuitionPosting)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const sp = new URL(request.url).searchParams
  const raw = sp.get('tab') ?? DEFAULT_TAB
  if (!isTeamTab(raw)) return NextResponse.json({ error: 'Unknown tab.' }, { status: 400 })
  if (!mayOpenTab(gate.actor.adminRole, raw)) {
    return NextResponse.json({ error: 'Your account cannot open this tab.' }, { status: 403 })
  }

  if (raw === 'paid') {
    const period = parsePeriod(sp.get('period'))
    const board = await loadSignupBoard(gate.actor, period)
    return NextResponse.json({
      tab: raw,
      period,
      everyone: board.everyone,
      rows: board.rows.map(({ staffId, name, tutor, parent, inProgress, paidChange }) => ({
        staffId,
        name,
        paid: tutor.paid,
        paidChange,
        inProgress,
        parent,
      })),
      total: board.total
        ? { paid: board.total.tutor.paid, inProgress: board.total.inProgress, parent: board.total.parent }
        : null,
    })
  }

  if (raw === 'posted') {
    const { rows, total } = await loadTuitionPosting()
    return NextResponse.json({ tab: raw, rows, total })
  }

  const staff = await loadStaffActivity()
  const rows = sortVerificationRows(staff.map((s) => ({ id: s.id, name: s.name, counts: verificationCounts(s.counts) })))
  return NextResponse.json({ tab: raw, rows, total: verificationTotal(rows) })
}
