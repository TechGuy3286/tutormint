import { NextResponse } from 'next/server'

import { checkAdminRole, roleMayWrite, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseSupervisorMember } from '@/lib/supervisorScope'
import { refuseEraseRequestedContact } from '@/lib/eraseRequestedGuard'
import { nextCard, openWhatsApp, recordOutcome } from '@/lib/followUpMode'
import { MODE_STAGES, OUTCOMES } from '@/lib/followUpModeCore'
import { parseBody, uuid, z } from '@/lib/validate'

// POST /api/admin/people/follow-up-mode (owner, 23 Nov 2026 — PR-18 Part B):
//
//   { action: 'next', stage, skip }           the next tutor, held for 10 minutes
//   { action: 'open', memberId, stage }       the WhatsApp link, built here; the
//                                             number reveal is logged first
//   { action: 'outcome', memberId, stage, outcome, reason?, note? }
//                                             Sent / No answer / Not interested /
//                                             Skip, then the hold is released
//
// Who: the follow-up list's own access (SCREEN_ACCESS.unpaidSignups); a
// view-only role is refused. A Manager works only their own cities. The phone
// is never returned — only the WhatsApp link, on "Open WhatsApp".

export const dynamic = 'force-dynamic'

const stage = z.enum(MODE_STAGES)
const Body = z.union([
  z.object({ action: z.literal('next'), stage, skip: z.array(uuid).max(2000).default([]) }),
  z.object({ action: z.literal('open'), memberId: uuid, stage }),
  z.object({
    action: z.literal('outcome'),
    memberId: uuid,
    stage,
    outcome: z.enum(OUTCOMES),
    reason: z.string().max(40).nullish(),
    note: z.string().max(500).nullish(),
  }),
])

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.unpaidSignups)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  if (!roleMayWrite(gate.actor.adminRole, SCREEN_ACCESS.unpaidSignups)) {
    return NextResponse.json({ error: 'You can view People but not record follow-ups.' }, { status: 403 })
  }
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const b = parsed.data
  const noStore = { headers: { 'cache-control': 'no-store' } }

  if (b.action === 'next') {
    const card = await nextCard(gate.actor, b.stage, b.skip)
    return NextResponse.json({ card }, noStore)
  }

  const scope = await refuseSupervisorMember(gate.actor, b.memberId)
  if (scope) return scope
  if (b.action === 'open' || b.outcome !== 'skip') {
    const erase = await refuseEraseRequestedContact(gate.actor, b.memberId)
    if (erase) return erase
  }

  if (b.action === 'open') {
    const res = await openWhatsApp(gate.actor, b.memberId, b.stage)
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    return NextResponse.json({ waHref: res.waHref }, noStore)
  }

  const res = await recordOutcome(gate.actor, { memberId: b.memberId, stage: b.stage, outcome: b.outcome, reason: b.reason ?? null, note: b.note ?? null })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ success: true, counted: res.counted }, noStore)
}
