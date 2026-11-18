import { NextResponse } from 'next/server'
import { refuseEraseRequestedContact } from '@/lib/eraseRequestedGuard'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseSupervisorMember } from '@/lib/supervisorScope'
import { undoTutorFollowUp } from '@/lib/followUps'
import { createAdminClient } from '@/lib/supabase/admin'
import { refreshPipelineRow } from '@/lib/tutorPipeline'
import { movedJson } from '@/lib/pipelineRowUpdateCore'
import { recordCallAttempt, recordPipelineFollowUp } from '@/lib/tutorPipelineRecord'
import { CALL_ATTEMPTS, FOLLOW_STAGES, PIPE_KINDS } from '@/lib/tutorPipelineCore'
import { parseBody, uuid, z } from '@/lib/validate'

// POST /api/admin/people/follow-up (owner, 8 Nov 2026; 15 Nov 2026) — People → Tutors
// and the admin member page.
//
//   { action: 'record', memberId, stage, kind, from? }
//       one follow-up: a WhatsApp message, a voice note, a call that reached
//       them ("Yes, talked") or a Team inbox message, for the tutor's current
//       stage (missing / rejected / approved). The server works the stage out
//       again and refuses when it changed. From the card ('card', the default)
//       only the kind that is due is accepted (a call always is); from the
//       member page ('member') any contact counts as the next follow-up.
//       Logged with the staff member and the time (member_follow_ups, source
//       'unpaid'), so it counts in Team activity, and the card moves at once.
//   { action: 'attempt', memberId, outcome }
//       a call that did not reach them: 'no_answer' (due again tomorrow) or
//       'wrong_number'. An attempt only — never a follow-up.
//   { action: 'undo', id }
//       the 10-second Undo — only the person who sent it, only just after.
//
// Who: the follow-up list's own access (SCREEN_ACCESS.unpaidSignups); a
// view-only role is refused by checkAdminRole. Nothing is deleted.

export const dynamic = 'force-dynamic'

const Body = z.union([
  z.object({
    action: z.literal('record'),
    memberId: uuid,
    stage: z.enum(FOLLOW_STAGES),
    kind: z.enum(PIPE_KINDS),
    from: z.enum(['card', 'member']).optional(),
  }),
  z.object({ action: z.literal('attempt'), memberId: uuid, outcome: z.enum(CALL_ATTEMPTS) }),
  z.object({ action: z.literal('undo'), id: uuid }),
])

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.unpaidSignups)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const b = parsed.data
  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'This is not working right now. Please try again in a few minutes.' }, { status: 503 })

  if (b.action === 'undo') {
    const { data: row } = await admin.from('member_follow_ups').select('member_id').eq('id', b.id).maybeSingle()
    const res = await undoTutorFollowUp(b.id, gate.actor)
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    const moved = row?.member_id ? await refreshPipelineRow(row.member_id as string) : null
    return NextResponse.json({ success: true, ...movedJson(moved) })
  }

  const scope = await refuseSupervisorMember(gate.actor, b.memberId)
  if (scope) return scope
  const erase = await refuseEraseRequestedContact(gate.actor, b.memberId)
  if (erase) return erase

  if (b.action === 'attempt') {
    const res = await recordCallAttempt(b.memberId, b.outcome, gate.actor)
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    return NextResponse.json({ success: true, suggestNotInterested: b.outcome === 'wrong_number', ...movedJson(res.moved) })
  }

  const res = await recordPipelineFollowUp({ memberId: b.memberId, kind: b.kind, actor: gate.actor, expectStage: b.stage, strict: (b.from ?? 'card') === 'card' })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ success: true, id: res.id, number: res.number, ...movedJson(res.moved) })
}
