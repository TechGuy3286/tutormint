import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { requireFreshAuth } from '@/lib/reauth'
import { loadStaffDocDecisions, pkDayRange, undoStaffDocDecision } from '@/lib/staffDocDecisions'
import { parseBody, text, z, uuid } from '@/lib/validate'

// "Documents approved by staff" (owner, 5 Nov 2026): CNIC / photo / selfie
// decisions Backend Support made.
//   GET ?day=YYYY-MM-DD   the list (Owner; the Partner views)
//   POST {decisionId, reason}  OWNER ONLY: undo — the document goes back to
//                waiting and any badge it gave goes; logged.

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.staffDocDecisions)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const day = new URL(request.url).searchParams.get('day') ?? ''
  const range = day ? pkDayRange(day) : null
  const rows = await loadStaffDocDecisions({ includeUndone: true, sinceIso: range?.[0], untilIso: range?.[1] })
  return NextResponse.json({ rows }, { headers: { 'Cache-Control': 'private, no-store' } })
}

const Body = z.object({ decisionId: uuid, reason: text({ min: 3, max: 500, label: 'Reason' }) })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.staffDocDecisions)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const notOwner = await refuseUnlessOwnerApproval(gate.actor, 'undo a staff decision on a document', null)
  if (notOwner) return notOwner
  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const r = await undoStaffDocDecision(parsed.data.decisionId, parsed.data.reason, { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true })
}
