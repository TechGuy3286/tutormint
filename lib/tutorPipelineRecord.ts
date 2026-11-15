// lib/tutorPipelineRecord.ts
//
// Logging a People → Tutors follow-up, from ANY admin screen (owner, 15 Nov
// 2026): the pipeline card, the member page (WhatsApp, voice note, a call that
// reached them) and a Team inbox message sent to the tutor. One writer, so a
// contact counts the same wherever it was made and the card moves at once.
// Opening a card or a member page writes nothing.
//
// Also the call ATTEMPTS ("No answer", "Wrong number"): logged in
// tutor_contact_logs and on the member's file (Audit), never a follow-up.
//
// Service role; callers check SCREEN_ACCESS first. Never logs a phone or name.

import 'server-only'

import type { AdminActor } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { recordFollowUp } from '@/lib/followUps'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadTutorDocSummaries } from '@/lib/tutorDocSummaries'
import { loadPipeContacts, pipeDocsOf, refreshPipelineRow, type PipelineRowUpdate } from '@/lib/tutorPipeline'
import {
  followState,
  isFollowStage,
  kindAllowed,
  pipelineStage,
  pipeProgress,
  pipeTemplateKey,
  STAGE_LABEL,
  type CallAttempt,
  type FollowStage,
  type PipeKind,
} from '@/lib/tutorPipelineCore'

const BUSY = 'This is not working right now. Please try again in a few minutes.'

type Fail = { ok: false; status: number; error: string }

/** The tutor's current followed-up stage, worked out again on the server. */
export async function currentFollowStage(
  memberId: string,
): Promise<{ ok: true; stage: FollowStage; nextNumber: number; nextKind: ReturnType<typeof followState>['nextKind'] } | Fail> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: BUSY }
  const [{ data: prof }, { data: tp }, { data: ni }, docs, contacts] = await Promise.all([
    admin.from('profiles').select('role, profile_completion').eq('id', memberId).maybeSingle(),
    admin.from('tutor_profiles').select('verified_fee_paid_at').eq('id', memberId).maybeSingle(),
    admin.from('follow_up_dismissals').select('id').eq('member_id', memberId).is('undone_at', null).limit(1),
    loadTutorDocSummaries([memberId]),
    loadPipeContacts([memberId]),
  ])
  if (prof?.role !== 'tutor') return { ok: false, status: 404, error: 'That tutor was not found.' }
  if ((ni ?? []).length > 0) return { ok: false, status: 409, error: 'This tutor is marked Not interested. Undo that first.' }
  const stage = pipelineStage({ ...pipeDocsOf(docs.get(memberId)), feePaid: !!tp?.verified_fee_paid_at, completion: Number(prof?.profile_completion ?? 0) || 0 })
  if (!isFollowStage(stage)) {
    return { ok: false, status: 409, error: `This tutor is now in “${STAGE_LABEL[stage]}”, which has no follow-up. Refresh the page.` }
  }
  const f = followState(stage, contacts.get(memberId) ?? [], Date.now())
  return { ok: true, stage, nextNumber: f.nextNumber, nextKind: f.nextKind }
}

/**
 * Log one follow-up. `expectStage` = the stage the screen showed (a stale
 * screen is refused). `strict` = the pipeline card: only the kind that is due
 * (a call and a Team inbox message always count). The member page and the
 * Team inbox are not strict — any contact there is the next follow-up.
 */
export async function recordPipelineFollowUp(a: {
  memberId: string
  kind: PipeKind
  actor: AdminActor
  expectStage?: FollowStage | null
  strict: boolean
}): Promise<{ ok: true; id: string; number: number; stage: FollowStage; moved: PipelineRowUpdate | null } | Fail> {
  const cur = await currentFollowStage(a.memberId)
  if (!cur.ok) return cur
  if (a.expectStage && a.expectStage !== cur.stage) {
    return { ok: false, status: 409, error: `This tutor moved to “${STAGE_LABEL[cur.stage]}”. Refresh the page for the right message.` }
  }
  if (a.strict && !kindAllowed(cur.nextKind, a.kind)) {
    const want = cur.nextKind === 'whatsapp' ? 'a WhatsApp message' : cur.nextKind === 'voice' ? 'a voice note' : 'a WhatsApp message or a call'
    return { ok: false, status: 409, error: `Follow-up ${cur.nextNumber} is ${want}.` }
  }
  const res = await recordFollowUp({
    memberId: a.memberId,
    channel: a.kind === 'call' ? 'call' : a.kind === 'inbox' ? 'email' : 'whatsapp',
    templateKey: pipeTemplateKey(cur.stage, a.kind),
    source: 'unpaid',
    reason: cur.stage,
    progress: pipeProgress(cur.stage),
    actor: a.actor,
  })
  if (!res.ok) return res
  const moved = await refreshPipelineRow(a.memberId)
  return { ok: true, id: res.id, number: cur.nextNumber, stage: cur.stage, moved }
}

/** A Team inbox message to a tutor in a followed-up stage is a follow-up.
 *  Best effort: never blocks or fails the send. */
export async function recordInboxFollowUp(memberId: string, actor: AdminActor, kind: 'inbox' | 'whatsapp' = 'inbox'): Promise<void> {
  try {
    // Refused quietly when they are not a tutor, not due a follow-up stage, or Not interested.
    await recordPipelineFollowUp({ memberId, kind, actor, strict: false })
  } catch {
    /* the message is sent either way */
  }
}

/** "No answer" or "Wrong number" — logged as an attempt only (owner, 15 Nov 2026). */
export async function recordCallAttempt(memberId: string, outcome: CallAttempt, actor: AdminActor): Promise<{ ok: true; moved: PipelineRowUpdate | null } | Fail> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: BUSY }
  const { data: prof } = await admin.from('profiles').select('role').eq('id', memberId).maybeSingle()
  if (prof?.role !== 'tutor') return { ok: false, status: 404, error: 'That tutor was not found.' }
  const { error } = await admin.from('tutor_contact_logs').insert({
    tutor_id: memberId,
    outcome,
    note: null,
    staff_id: actor.id,
    staff_email: actor.email ?? null,
  })
  if (error) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email ?? null,
    action: 'member.call_attempt',
    targetType: 'profile',
    targetId: memberId,
    detail: { outcome },
  })
  const moved = await refreshPipelineRow(memberId)
  return { ok: true, moved }
}
