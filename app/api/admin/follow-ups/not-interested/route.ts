import { NextResponse } from 'next/server'

import { checkAdminRole, roleMayWrite, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseSupervisorMember } from '@/lib/supervisorScope'
import { markNotInterested, undoNotInterested } from '@/lib/followUpDismissals'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseBody, uuid, z } from '@/lib/validate'

// "Not interested" on Follow-ups, and its undo (owner, 21 Oct 2026). Whoever
// can work the member's own list may use it: a tutor is on Follow-ups → Tutors
// (SCREEN_ACCESS.unpaidSignups), everyone else on Parents
// (SCREEN_ACCESS.signups). Audited in lib/followUpDismissals.

export const dynamic = 'force-dynamic'

const Body = z.object({
  memberId: uuid,
  undo: z.boolean().optional(),
  note: z.string().max(500).nullish(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...new Set([...SCREEN_ACCESS.unpaidSignups, ...SCREEN_ACCESS.signups]))
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const b = parsed.data

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'This is not working right now. Please try again in a few minutes.' }, { status: 503 })
  const { data: member } = await admin.from('profiles').select('role').eq('id', b.memberId).maybeSingle()
  if (!member) return NextResponse.json({ error: 'That member was not found.' }, { status: 404 })
  const list = member.role === 'tutor' ? SCREEN_ACCESS.unpaidSignups : SCREEN_ACCESS.signups
  if (!roleMayWrite(gate.actor.adminRole, list)) {
    return NextResponse.json({ error: 'You do not have access to that list.' }, { status: 403 })
  }

  // A Supervisor changes only their own tuitions and cities (owner, 24 Oct 2026).
  const scope = await refuseSupervisorMember(gate.actor, b.memberId)
  if (scope) return scope
  const res = b.undo ? await undoNotInterested(b.memberId, gate.actor) : await markNotInterested(b.memberId, b.note ?? null, gate.actor)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ success: true })
}
