import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { undoFollowUps } from '@/lib/applicationFollowUps'
import { parseBody, z, uuid } from '@/lib/validate'

// POST /api/admin/applications/follow-up/undo (owner, 22 Oct 2026, Applications v3)
//
// The 10-second Undo: the staff member did not actually send it. Only their own
// records; the rows are stamped undone, never deleted.

export const dynamic = 'force-dynamic'

const Body = z.object({ followUpIds: z.array(uuid).min(1).max(200) })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.applicantForwards)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const r = await undoFollowUps(gate.actor, parsed.data.followUpIds)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ success: true, undone: r.undone })
}
