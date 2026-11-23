import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseSupervisorMember } from '@/lib/supervisorScope'
import { claimOnIt, releaseOnIt, reassignOnIt } from '@/lib/memberClaims'
import { movedJson } from '@/lib/pipelineRowUpdateCore'
import { parseBody, uuid, z } from '@/lib/validate'

// POST /api/admin/members/on-it (owner, 23 Nov 2026 — PR-18 Part C.4):
//   { action: 'claim', memberId }              "I'm on it" — first tap wins
//   { action: 'release', memberId }            the claimer, or the Owner
//   { action: 'reassign', memberId, staffId }  Owner only
// For a tutor in a followed-up People stage the claim is that stage's
// follow-up and the card moves at once (lib/memberClaims).

export const dynamic = 'force-dynamic'

const Body = z.union([
  z.object({ action: z.literal('claim'), memberId: uuid }),
  z.object({ action: z.literal('release'), memberId: uuid }),
  z.object({ action: z.literal('reassign'), memberId: uuid, staffId: uuid }),
])

export async function POST(request: Request) {
  const gate = await checkAdminRole(...new Set([...SCREEN_ACCESS.unpaidSignups, ...SCREEN_ACCESS.signups]))
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const b = parsed.data
  const scope = await refuseSupervisorMember(gate.actor, b.memberId)
  if (scope) return scope

  if (b.action === 'claim') {
    const r = await claimOnIt(gate.actor, b.memberId)
    if (!r.ok) return NextResponse.json({ error: r.error, onIt: r.onIt ?? null }, { status: r.status })
    return NextResponse.json({ success: true, onIt: r.onIt, followUp: r.followUp, ...movedJson(r.moved) })
  }
  if (b.action === 'release') {
    const r = await releaseOnIt(gate.actor, b.memberId)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ success: true })
  }
  const r = await reassignOnIt(gate.actor, b.memberId, b.staffId)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ success: true, onIt: r.onIt })
}
