import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseUnlessOwnerTargets } from '@/lib/ownerGuard'
import { loadTargetBoard, mayViewTargetStaff, saveTargets, setOnTargetList } from '@/lib/staffTargets'
import { isMonthKey, parseCountingStart, parseMonth, parseTargetValue } from '@/lib/staffTargetsCore'
import { parseBody, z, uuid } from '@/lib/validate'

// Monthly paid sign-up targets (owner, 16 Oct 2026).
//   GET  ?month=YYYY-MM[&staff=<id>]   the Paid sign-ups board, cut on the
//        server to what the caller may see (lib/staffTargets loadTargetBoard).
//        Asking for another staff member's numbers without seeing everyone → 403.
//   POST { action: 'set', month, targets: [{ staffId, target }], countingStarts?: 'YYYY-MM-DD' }
//        (countingStarts — the month's "Counting starts" date, a day inside
//        that month; empty leaves it as it is. Audited in staff.targets_set.)
//        { action: 'list', staffId, onList }
//        Owner only — every other role gets 403 and the Owner is alerted.
//        Every change is written to Audit. Counts only, never an amount.

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.tuitionPosting)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const sp = new URL(request.url).searchParams
  const now = Date.now()
  const rawMonth = sp.get('month')
  if (rawMonth && !isMonthKey(rawMonth)) return NextResponse.json({ error: 'Month must look like 2026-10.' }, { status: 400 })
  const staff = sp.get('staff')
  if (staff && !mayViewTargetStaff(gate.actor, staff)) {
    return NextResponse.json({ error: 'You can only see your own sign-ups.' }, { status: 403 })
  }
  const board = await loadTargetBoard(gate.actor, parseMonth(rawMonth, now), now, staff)
  return NextResponse.json(board)
}

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set'),
    month: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/),
    targets: z.array(z.object({ staffId: uuid, target: z.union([z.number(), z.string(), z.null()]) })).max(100),
    countingStarts: z.union([z.string().max(10), z.null()]).optional(),
  }),
  z.object({ action: z.literal('list'), staffId: uuid, onList: z.boolean() }),
])

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.tuitionPosting)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const notOwner = await refuseUnlessOwnerTargets(
    gate.actor,
    body.action === 'set' ? `set staff targets for ${body.month}` : `change the staff target list`,
  )
  if (notOwner) return notOwner

  if (body.action === 'list') {
    const r = await setOnTargetList(gate.actor, body.staffId, body.onList)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ success: true })
  }

  const entries: { staffId: string; target: number | null }[] = []
  for (const t of body.targets) {
    const v = parseTargetValue(t.target)
    if (!v.ok) return NextResponse.json({ error: 'A target must be a whole number from 0 to 10000.' }, { status: 400 })
    entries.push({ staffId: t.staffId, target: v.value })
  }
  const start = parseCountingStart(body.countingStarts, body.month)
  if (!start.ok) return NextResponse.json({ error: 'The counting start date must be a day in that month.' }, { status: 400 })
  const r = await saveTargets(gate.actor, body.month, entries, start.value)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ success: true, changed: r.changed })
}
