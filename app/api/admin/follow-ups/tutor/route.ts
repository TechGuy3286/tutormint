import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseSupervisorMember } from '@/lib/supervisorScope'
import { recordFollowUp, undoTutorFollowUp } from '@/lib/followUps'
import { FU_FEE_REPLY_KEY, isFollowReason } from '@/lib/followUpTemplatesCore'
import { parseBody, z, uuid } from '@/lib/validate'

// POST /api/admin/follow-ups/tutor (owner, 23 Oct 2026) — Follow-ups → Tutors.
//
//   { action: 'record', memberId, channel, reason, templateKey, progress }
//       one tap: the tutor, why they were messaged, the template, the progress
//       snapshot, the staff member and the time. The tutor moves to Followed
//       up. templateKey 'fu_fee_reply' is the "Fee reply" (the saved "About the
//       Verification Fee" message): allowed for any tutor, waiting on us
//       included, and counted like any other message.
//   { action: 'undo', id }
//       the 10-second Undo — only the person who sent it, only just after.
//
// Who: the list's own access (SCREEN_ACCESS.unpaidSignups); a view-only role
// is refused by checkAdminRole like every admin write. Nothing is deleted:
// Undo stamps the row.

export const dynamic = 'force-dynamic'

const Body = z.union([
  z.object({
    action: z.literal('record'),
    memberId: uuid,
    channel: z.enum(['whatsapp', 'call']),
    reason: z.string().max(40),
    templateKey: z.string().max(80).nullish(),
    progress: z.string().max(120),
  }),
  z.object({ action: z.literal('undo'), id: uuid }),
])

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.unpaidSignups)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const b = parsed.data

  if (b.action === 'undo') {
    const res = await undoTutorFollowUp(b.id, gate.actor)
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    return NextResponse.json({ success: true })
  }

  // A Supervisor changes only their own tuitions and cities (owner, 24 Oct 2026).
  const scope = await refuseSupervisorMember(gate.actor, b.memberId)
  if (scope) return scope
  const feeReply = b.channel === 'whatsapp' && b.templateKey === FU_FEE_REPLY_KEY
  if (!isFollowReason(b.reason)) return NextResponse.json({ error: 'That follow-up reason is not known.' }, { status: 400 })
  if (b.reason === 'waiting' && !feeReply) {
    return NextResponse.json({ error: 'That tutor is waiting on us — there is nothing to send.' }, { status: 400 })
  }
  const res = await recordFollowUp({
    memberId: b.memberId,
    channel: b.channel,
    templateKey: b.channel === 'whatsapp' ? (b.templateKey ?? null) : null,
    source: 'unpaid',
    reason: b.reason,
    progress: b.progress,
    actor: gate.actor,
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ success: true, id: res.id })
}
