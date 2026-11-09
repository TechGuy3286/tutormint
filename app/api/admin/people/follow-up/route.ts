import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseSupervisorMember } from '@/lib/supervisorScope'
import { recordFollowUp, undoTutorFollowUp } from '@/lib/followUps'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadTutorDocSummaries } from '@/lib/tutorDocSummaries'
import { loadPipeContacts, pipeDocsOf, refreshPipelineRow } from '@/lib/tutorPipeline'
import {
  FOLLOW_STAGES,
  followState,
  isFollowStage,
  kindAllowed,
  pipelineStage,
  pipeProgress,
  pipeTemplateKey,
  STAGE_LABEL,
} from '@/lib/tutorPipelineCore'
import { parseBody, uuid, z } from '@/lib/validate'

// POST /api/admin/people/follow-up (owner, 8 Nov 2026) — People → Tutors.
//
//   { action: 'record', memberId, stage, kind }
//       one follow-up: a WhatsApp message, a voice note or a call, for the
//       tutor's current stage (missing / rejected / approved). The server works
//       the stage out again and refuses when it changed or the kind is not the
//       one due (Follow-up 1 WhatsApp, 2 voice note, 3+ WhatsApp or call).
//       Logged with the staff member and the time (member_follow_ups, source
//       'unpaid'), so it counts in Team activity. The card moves to Followed up.
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
    kind: z.enum(['whatsapp', 'voice', 'call']),
  }),
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
    if (row?.member_id) await refreshPipelineRow(row.member_id as string)
    return NextResponse.json({ success: true })
  }

  const scope = await refuseSupervisorMember(gate.actor, b.memberId)
  if (scope) return scope

  const [{ data: prof }, { data: tp }, { data: ni }, docs, contacts] = await Promise.all([
    admin.from('profiles').select('role, profile_completion').eq('id', b.memberId).maybeSingle(),
    admin.from('tutor_profiles').select('verified_fee_paid_at').eq('id', b.memberId).maybeSingle(),
    admin.from('follow_up_dismissals').select('id').eq('member_id', b.memberId).is('undone_at', null).limit(1),
    loadTutorDocSummaries([b.memberId]),
    loadPipeContacts([b.memberId]),
  ])
  if (prof?.role !== 'tutor') return NextResponse.json({ error: 'That tutor was not found.' }, { status: 404 })
  if ((ni ?? []).length > 0) return NextResponse.json({ error: 'This tutor is marked Not interested. Undo that first.' }, { status: 409 })
  const stage = pipelineStage({ ...pipeDocsOf(docs.get(b.memberId)), feePaid: !!tp?.verified_fee_paid_at, completion: Number(prof?.profile_completion ?? 0) || 0 })
  if (!isFollowStage(stage)) {
    return NextResponse.json({ error: `This tutor is now in “${STAGE_LABEL[stage]}”, which has no follow-up. Refresh the list.` }, { status: 409 })
  }
  if (stage !== b.stage) {
    return NextResponse.json({ error: `This tutor moved to “${STAGE_LABEL[stage]}”. Refresh the list for the right message.` }, { status: 409 })
  }
  const f = followState(stage, contacts.get(b.memberId) ?? [], Date.now())
  if (!kindAllowed(f.nextKind, b.kind)) {
    const want = f.nextKind === 'whatsapp' ? 'a WhatsApp message' : f.nextKind === 'voice' ? 'a voice note' : 'a WhatsApp message or a call'
    return NextResponse.json({ error: `Follow-up ${f.nextNumber} is ${want}.` }, { status: 409 })
  }

  const res = await recordFollowUp({
    memberId: b.memberId,
    channel: b.kind === 'call' ? 'call' : 'whatsapp',
    templateKey: pipeTemplateKey(stage, b.kind),
    source: 'unpaid',
    reason: stage,
    progress: pipeProgress(stage),
    actor: gate.actor,
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  await refreshPipelineRow(b.memberId)
  return NextResponse.json({ success: true, id: res.id, number: f.nextNumber })
}
