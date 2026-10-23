// lib/applicationFollowUps.ts
//
// The server half of Applications v3 follow-ups (owner, 22 Oct 2026; rules in
// lib/applicationFollowUpCore, wording in lib/applicationMessagesCore).
//
// NUMBERS: the parent's and the tutor's full numbers are read here and go ONLY
// into the wa.me link returned to the staff member's browser. They are never
// stored on a follow-up, never in admin_audit_log, never on a timeline (those
// carry the recipient TYPE only), and never logged.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAllIn } from '@/lib/pageAll'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import type { AdminActor } from '@/lib/adminAuth'
import { formatName } from '@/lib/formatName'
import { normalisePkMobile } from '@/lib/phone'
import { tutorPath } from '@/lib/slugs'
import { adminWaLink } from '@/lib/adminWhatsAppCore'
import { applicantExcluded } from '@/lib/applicationTracking'
import { isStage, type Stage } from '@/lib/applicationStageCore'
import {
  ACTIVE_STAGES,
  STAGE_MESSAGE,
  STAGE_RECIPIENT,
  stageMessage,
  tutorUpdateMessage,
  type MessageKey,
  type Recipient,
} from '@/lib/applicationMessagesCore'
import {
  APPLIED_FORWARD_MESSAGE,
  FORWARD_UNDO_TEXT,
  forwardUndoProblem,
  type FollowUpKind,
  type FollowUpRecord,
} from '@/lib/applicationFollowUpCore'
import { STAGE_TEMPLATE } from '@/lib/applicationTemplatesCore'
import { loadAppTemplates, loadSupportWhatsApp } from '@/lib/applicationTemplates'
import { writeStage } from '@/lib/applicationTracking'
import { senderRefCode } from '@/lib/staffSignups'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

const NOT_WORKING = 'This is not working right now. Please try again in a few minutes.'

// ------------------------------------------------------------------- reads --

type FuRow = {
  id: string
  application_id: string
  stage: string
  kind: string
  recipient: string
  message_key: string
  staff_name: string | null
  created_at: string
}

/** Every follow-up that was not undone, per application. */
export async function loadFollowUps(admin: Admin, applicationIds: string[]): Promise<Map<string, FollowUpRecord[]>> {
  const rows = await pageAllIn<FuRow, string>(applicationIds, (ids, from, to) =>
    admin
      .from('application_follow_ups')
      .select('id, application_id, stage, kind, recipient, message_key, staff_name, created_at')
      .in('application_id', ids)
      .is('undone_at', null)
      .order('id')
      .range(from, to),
  )
  const out = new Map<string, FollowUpRecord[]>()
  for (const r of rows) {
    if (!isStage(r.stage)) continue
    const rec: FollowUpRecord = {
      id: r.id,
      applicationId: r.application_id,
      stage: r.stage,
      kind: r.kind as FollowUpKind,
      recipient: r.recipient as Recipient,
      messageKey: r.message_key as MessageKey,
      staffName: r.staff_name,
      at: r.created_at,
    }
    out.set(r.application_id, [...(out.get(r.application_id) ?? []), rec])
  }
  return out
}

type ParentContact = { name: string | null; raw: string | null }

/** Each tuition's parent contact, as staff see it: the real parent recorded
 *  with a team-posted tuition, else the account that posted it. */
export async function parentContacts(admin: Admin, jobIds: string[]): Promise<Map<string, ParentContact>> {
  const jobs = await pageAllIn<{ id: string; parent_id: string | null }, string>(jobIds, (ids, from, to) =>
    admin.from('jobs').select('id, parent_id').in('id', ids).order('id').range(from, to),
  )
  const parentIds = [...new Set(jobs.map((j) => j.parent_id).filter((v): v is string => !!v))]
  const [contacts, parents] = await Promise.all([
    pageAllIn<{ job_id: string; contact_name: string | null; contact_phone: string | null; contact_whatsapp: string | null }, string>(jobIds, (ids, from, to) =>
      admin.from('job_contacts').select('job_id, contact_name, contact_phone, contact_whatsapp').in('job_id', ids).order('job_id').range(from, to),
    ),
    pageAllIn<{ id: string; full_name: string | null; phone_number: string | null; whatsapp: string | null; is_team_account: boolean | null }, string>(
      parentIds,
      (ids, from, to) => admin.from('profiles').select('id, full_name, phone_number, whatsapp, is_team_account').in('id', ids).order('id').range(from, to),
    ),
  ])
  const contactBy = new Map(contacts.map((c) => [c.job_id, c]))
  const parentBy = new Map(parents.map((p) => [p.id, p]))
  const out = new Map<string, ParentContact>()
  for (const j of jobs) {
    const p = j.parent_id ? parentBy.get(j.parent_id) : undefined
    const c = contactBy.get(j.id)
    if (p?.is_team_account) out.set(j.id, { name: c?.contact_name ?? null, raw: c?.contact_whatsapp || c?.contact_phone || null })
    else out.set(j.id, { name: formatName(p?.full_name) || null, raw: p?.whatsapp || p?.phone_number || null })
  }
  return out
}

// ------------------------------------------------------------------ writes --

type AppRow = { id: string; job_id: string; tutor_id: string; stage: string; withdrawn_at: string | null }

async function actorName(admin: Admin, actor: AdminActor): Promise<string | null> {
  const { data } = await admin.from('profiles').select('full_name').eq('id', actor.id).maybeSingle()
  return formatName(data?.full_name as string | null) || null
}

async function insertFollowUps(
  admin: Admin,
  actor: AdminActor,
  name: string | null,
  apps: { id: string; job_id: string; tutor_id: string; stage: Stage }[],
  kind: FollowUpKind,
  recipient: Recipient,
  messageKey: (a: { stage: Stage }) => MessageKey,
  /** v3.1 Applied message: one time stamp, the forward it made, and what to
   *  restore on Undo. */
  extra?: { at: string; forwardId: string; restore: Record<string, unknown> },
): Promise<string[]> {
  if (apps.length === 0) return []
  const { data, error } = await admin
    .from('application_follow_ups')
    .insert(
      apps.map((a) => ({
        application_id: a.id,
        job_id: a.job_id,
        tutor_id: a.tutor_id,
        stage: a.stage,
        kind,
        recipient,
        message_key: messageKey(a),
        staff_id: actor.id,
        staff_name: name,
        ...(extra ? { created_at: extra.at, forward_id: extra.forwardId, restore: extra.restore } : {}),
      })),
    )
    .select('id, application_id')
  if (error) throw new Error(error.message)
  const now = extra?.at ?? new Date().toISOString()
  // Activity on the application (v2's worked_at) as well.
  await admin.from('applications').update({ worked_at: now, worked_by: actor.id, worked_by_name: name }).in('id', apps.map((a) => a.id))
  for (const a of apps) {
    // The tuition's history and the tutor's timeline: the recipient TYPE only.
    await logAdminAction({
      actorId: actor.id,
      actorRole: actor.adminRole,
      actorEmail: actor.email,
      action: kind === 'tutor_update' ? 'application.tutor_update' : 'application.follow_up',
      targetType: 'job',
      targetId: a.job_id,
      detail: { applicationId: a.id, tutorId: a.tutor_id, stage: a.stage, recipient, message: messageKey(a) },
    })
    await logActivity({
      userId: a.tutor_id,
      event: 'application_follow_up',
      targetType: 'application',
      targetId: a.id,
      meta: { jobId: a.job_id, stage: a.stage, recipient, kind, message: messageKey(a) },
    })
  }
  return (data ?? []).map((r) => r.id as string)
}

export type SendResult = { ok: true; href: string; followUpIds: string[] } | { ok: false; status: 400 | 404 | 503; error: string }

/**
 * A row's WhatsApp button: the stage's recipient and message, recorded as one
 * follow-up. Returns the wa.me link (the only place the number goes) and the
 * record's id for Undo.
 */
export async function sendStageFollowUp(actor: AdminActor, applicationId: string): Promise<SendResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_WORKING }
  const { data } = await admin.from('applications').select('id, job_id, tutor_id, stage, withdrawn_at').eq('id', applicationId).maybeSingle()
  const app = data as AppRow | null
  if (!app?.job_id || app.withdrawn_at || !isStage(app.stage)) return { ok: false, status: 404, error: 'That application was not found. Reload the page.' }
  const stage = app.stage
  const recipient = STAGE_RECIPIENT[stage]
  const [{ data: job }, { data: tutor }, { data: tp }, contacts, templates, support] = await Promise.all([
    admin.from('jobs').select('id, ref_id, title, city').eq('id', app.job_id).maybeSingle(),
    admin.from('profiles').select('full_name, phone_number, whatsapp').eq('id', app.tutor_id).maybeSingle(),
    admin.from('tutor_profiles').select('slug, city').eq('id', app.tutor_id).maybeSingle(),
    parentContacts(admin, [app.job_id]),
    loadAppTemplates(admin),
    loadSupportWhatsApp(admin),
  ])
  const parent = contacts.get(app.job_id)
  const raw = recipient === 'parent' ? (parent?.raw ?? null) : ((tutor?.whatsapp as string | null) || (tutor?.phone_number as string | null))
  if (!normalisePkMobile(raw)) {
    return { ok: false, status: 400, error: recipient === 'parent' ? 'No parent number on this tuition.' : 'No tutor number on file.' }
  }
  const text = stageMessage(
    {
      stage,
      ref: (job?.ref_id as string | null) ?? null,
      title: (job?.title as string | null) ?? 'Tuition',
      parentName: parent?.name ?? null,
      tutorName: formatName(tutor?.full_name as string | null),
      tutorProfilePath: tutorPath(tp?.slug as string | null),
      tutorCity: (tp?.city as string | null) ?? null,
      jobCity: (job?.city as string | null) ?? null,
    },
    { template: templates.get(STAGE_TEMPLATE[stage]) ?? null, supportWhatsApp: support },
  )
  const href = adminWaLink(raw, text, await senderRefCode(actor.id))
  if (!href) return { ok: false, status: 400, error: 'That number cannot receive WhatsApp.' }
  const name = await actorName(admin, actor)
  try {
    if (stage === 'applied') {
      const ids = await forwardByAppliedMessage(admin, actor, name, app.id)
      return { ok: true, href, followUpIds: ids }
    }
    const ids = await insertFollowUps(admin, actor, name, [{ ...app, stage }], 'follow_up', recipient, () => STAGE_MESSAGE[stage])
    return { ok: true, href, followUpIds: ids }
  } catch {
    return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  }
}

type FullApp = {
  id: string
  job_id: string
  tutor_id: string
  stage: string
  withdrawn_at: string | null
  stage_changed_at: string | null
  stage_changed_by: string | null
  stage_changed_by_name: string | null
  worked_at: string | null
  worked_by: string | null
  worked_by_name: string | null
}
/** The channel a forward by the Applied message is recorded with. */
const FORWARD_CHANNEL = 'whatsapp'
const FULL_APP_COLS = 'id, job_id, tutor_id, stage, withdrawn_at, stage_changed_at, stage_changed_by, stage_changed_by_name, worked_at, worked_by, worked_by_name'

/**
 * Applications v3.1 (owner, 23 Oct 2026): the Applied-stage message to the
 * parent shares the tutor's profile — that IS forwarding. Exactly what
 * "Mark as forwarded" does for this one tutor, with ONE time stamp:
 *   1. the stage moves Applied → Forwarded (history, audit, timeline);
 *   2. a forward is recorded on the tuition ("already sent" in the panel);
 *   3. the parent follow-up is recorded at the Forwarded stage → Sent, due
 *      again 3 days later.
 * The follow-up keeps the forward's id and the stage fields it replaced, so
 * Undo can put everything back.
 */
async function forwardByAppliedMessage(admin: Admin, actor: AdminActor, name: string | null, applicationId: string): Promise<string[]> {
  const { data } = await admin.from('applications').select(FULL_APP_COLS).eq('id', applicationId).maybeSingle()
  const app = data as FullApp | null
  if (!app || app.withdrawn_at || app.stage !== 'applied') throw new Error('not applied')
  const at = new Date().toISOString()
  const restore = {
    stage_changed_at: app.stage_changed_at,
    stage_changed_by: app.stage_changed_by,
    stage_changed_by_name: app.stage_changed_by_name,
    worked_at: app.worked_at,
    worked_by: app.worked_by,
    worked_by_name: app.worked_by_name,
  }
  const moved = await writeStage(admin, actor, name, { ...app, stage: 'applied' }, 'forwarded', 'applied message sent to parent', at)
  if (!moved) throw new Error('stage did not move')
  const { data: fwd, error } = await admin
    .from('applicant_forwards')
    .insert({ job_id: app.job_id, channel: FORWARD_CHANNEL, tutor_ids: [app.tutor_id], staff_id: actor.id, staff_email: actor.email, staff_name: name, created_at: at })
    .select('id')
    .single()
  if (error || !fwd) throw new Error(error?.message ?? 'forward not saved')
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'applicants.forward',
    targetType: 'job',
    targetId: app.job_id,
    detail: { forwardId: fwd.id, channel: FORWARD_CHANNEL, tutorIds: [app.tutor_id], tutorCount: 1, via: 'applied_message', applicationId: app.id },
  })
  return insertFollowUps(
    admin,
    actor,
    name,
    [{ id: app.id, job_id: app.job_id, tutor_id: app.tutor_id, stage: 'forwarded' }],
    'follow_up',
    'parent',
    () => APPLIED_FORWARD_MESSAGE,
    { at, forwardId: fwd.id as string, restore },
  )
}

/**
 * By tutor: one message to the tutor listing every ACTIVE application of theirs
 * (counted ones only), a tutor update recorded on each. Not a parent follow-up.
 */
export async function sendTutorUpdate(actor: AdminActor, tutorId: string): Promise<SendResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_WORKING }
  const [{ data: person }, { data: rows }] = await Promise.all([
    admin.from('profiles').select('full_name, phone_number, whatsapp, role, is_seed, is_team_account, is_test_name, hidden_from_public').eq('id', tutorId).maybeSingle(),
    admin.from('applications').select('id, job_id, tutor_id, stage, withdrawn_at').eq('tutor_id', tutorId),
  ])
  if (!person || applicantExcluded({ id: tutorId, ...(person as Record<string, unknown>) } as never)) return { ok: false, status: 404, error: 'That tutor was not found.' }
  const active = ((rows ?? []) as AppRow[]).filter((a) => a.job_id && !a.withdrawn_at && isStage(a.stage) && ACTIVE_STAGES.includes(a.stage as Stage))
  if (active.length === 0) return { ok: false, status: 400, error: 'This tutor has no applications in progress.' }
  const raw = (person.whatsapp as string | null) || (person.phone_number as string | null)
  if (!normalisePkMobile(raw)) return { ok: false, status: 400, error: 'No tutor number on file.' }
  const jobs = await pageAllIn<{ id: string; ref_id: string | null; title: string | null; created_at: string }, string>([...new Set(active.map((a) => a.job_id))], (ids, from, to) =>
    admin.from('jobs').select('id, ref_id, title, created_at').in('id', ids).order('id').range(from, to),
  )
  const jobBy = new Map(jobs.map((j) => [j.id, j]))
  const items = active
    .map((a) => ({ a, j: jobBy.get(a.job_id) }))
    .sort((x, y) => (Date.parse(y.j?.created_at ?? '') || 0) - (Date.parse(x.j?.created_at ?? '') || 0))
  const [templates, support, { data: tp }] = await Promise.all([
    loadAppTemplates(admin),
    loadSupportWhatsApp(admin),
    admin.from('tutor_profiles').select('city').eq('id', tutorId).maybeSingle(),
  ])
  const text = tutorUpdateMessage(
    formatName(person.full_name as string | null),
    items.map(({ a, j }) => ({ ref: j?.ref_id ?? null, title: j?.title ?? 'Tuition', stage: a.stage as Stage })),
    { template: templates.get('app_tutor_update') ?? null, supportWhatsApp: support, tutorCity: (tp?.city as string | null) ?? null },
  )
  const href = adminWaLink(raw, text, await senderRefCode(actor.id))
  if (!href) return { ok: false, status: 400, error: 'That number cannot receive WhatsApp.' }
  try {
    const ids = await insertFollowUps(
      admin,
      actor,
      await actorName(admin, actor),
      items.map(({ a }) => ({ ...a, stage: a.stage as Stage })),
      'tutor_update',
      'tutor',
      () => 'tutor_update',
    )
    return { ok: true, href, followUpIds: ids }
  } catch {
    return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  }
}

/** "Mark as forwarded" in the forward panel: a parent follow-up on each selected
 *  tutor's application, at the stage it is now at (Forwarded, once moved). */
export async function recordForwardFollowUps(actor: AdminActor, jobId: string, tutorIds: string[]): Promise<number> {
  const admin = createAdminClient()
  if (!admin || tutorIds.length === 0) return 0
  const { data } = await admin.from('applications').select('id, job_id, tutor_id, stage, withdrawn_at').eq('job_id', jobId).in('tutor_id', tutorIds)
  const apps = ((data ?? []) as AppRow[]).filter((a) => !a.withdrawn_at && isStage(a.stage)).map((a) => ({ ...a, stage: a.stage as Stage }))
  try {
    return (await insertFollowUps(admin, actor, await actorName(admin, actor), apps, 'follow_up', 'parent', () => 'forward')).length
  } catch {
    return 0
  }
}

/** Undo: the staff member did not actually send it. The rows are kept, stamped. */
export async function undoFollowUps(actor: AdminActor, ids: string[]): Promise<UndoResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_WORKING }
  let list = [...new Set(ids)].slice(0, 200)
  if (list.length === 0) return { ok: false, status: 400, error: 'Nothing to undo.' }
  // v3.1: a follow-up made by the Applied message also forwarded the tutor and
  // moved the stage. Those are undone as a whole, or not at all.
  const { data: forwardKind } = await admin.from('application_follow_ups').select('id').in('id', list).not('forward_id', 'is', null)
  const forwardIds = new Set((forwardKind ?? []).map((r) => r.id as string))
  let undone = 0
  for (const id of forwardIds) {
    const r = await undoAppliedForward(admin, actor, id)
    if (!r.ok) return r
    undone++
  }
  list = list.filter((id) => !forwardIds.has(id))
  if (list.length === 0) return { ok: true, undone }
  const { data, error } = await admin
    .from('application_follow_ups')
    .update({ undone_at: new Date().toISOString(), undone_by: actor.id })
    .in('id', list)
    .eq('staff_id', actor.id)
    .is('undone_at', null)
    .select('id, application_id, job_id, tutor_id, stage, kind, recipient')
  if (error) return { ok: false, status: 400, error: 'That did not undo. Please try again.' }
  for (const r of data ?? []) {
    await logAdminAction({
      actorId: actor.id,
      actorRole: actor.adminRole,
      actorEmail: actor.email,
      action: 'application.follow_up_undo',
      targetType: 'job',
      targetId: r.job_id as string,
      detail: { applicationId: r.application_id, tutorId: r.tutor_id, stage: r.stage, recipient: r.recipient, kind: r.kind },
    })
    await logActivity({
      userId: r.tutor_id as string,
      event: 'application_follow_up_undone',
      targetType: 'application',
      targetId: r.application_id as string,
      meta: { jobId: r.job_id, recipient: r.recipient, kind: r.kind },
    })
  }
  return { ok: true, undone: undone + (data ?? []).length }
}

type UndoResult = { ok: true; undone: number } | { ok: false; status: 400 | 403 | 409 | 503; error: string }

/**
 * Undo of the Applied message (v3.1): back to Applied with the stage fields it
 * had, the forward record and the follow-up marked undone (never deleted).
 * Refused once anything else has touched the application since.
 */
async function undoAppliedForward(admin: Admin, actor: AdminActor, followUpId: string): Promise<UndoResult> {
  const { data: fu } = await admin
    .from('application_follow_ups')
    .select('id, application_id, job_id, tutor_id, stage, kind, recipient, staff_id, created_at, undone_at, forward_id, restore')
    .eq('id', followUpId)
    .maybeSingle()
  if (!fu) return { ok: false, status: 400, error: 'Nothing to undo.' }
  const [{ data: app }, { count: later }] = await Promise.all([
    admin.from('applications').select('stage, stage_changed_at, worked_at, withdrawn_at').eq('id', fu.application_id as string).maybeSingle(),
    admin
      .from('application_follow_ups')
      .select('id', { count: 'exact', head: true })
      .eq('application_id', fu.application_id as string)
      .is('undone_at', null)
      .neq('id', fu.id as string)
      .gte('created_at', fu.created_at as string),
  ])
  const problem = forwardUndoProblem({
    actorId: actor.id,
    nowMs: Date.now(),
    followUp: { staffId: (fu.staff_id as string | null) ?? null, at: fu.created_at as string, undoneAt: (fu.undone_at as string | null) ?? null },
    app: app
      ? {
          stage: app.stage as string,
          stageChangedAt: (app.stage_changed_at as string | null) ?? null,
          workedAt: (app.worked_at as string | null) ?? null,
          withdrawnAt: (app.withdrawn_at as string | null) ?? null,
        }
      : null,
    laterFollowUps: later ?? 0,
  })
  if (problem) return { ok: false, status: problem === 'not_yours' ? 403 : 409, error: FORWARD_UNDO_TEXT[problem] }

  const restore = (fu.restore ?? {}) as Record<string, string | null>
  const now = new Date().toISOString()
  // Back to Applied — guarded so a change that lands in between is not undone.
  const { data: back, error } = await admin
    .from('applications')
    .update({
      stage: 'applied',
      stage_changed_at: restore.stage_changed_at ?? null,
      stage_changed_by: restore.stage_changed_by ?? null,
      stage_changed_by_name: restore.stage_changed_by_name ?? null,
      worked_at: restore.worked_at ?? null,
      worked_by: restore.worked_by ?? null,
      worked_by_name: restore.worked_by_name ?? null,
    })
    .eq('id', fu.application_id as string)
    .eq('stage', 'forwarded')
    .eq('stage_changed_at', fu.created_at as string)
    .select('id')
  if (error) return { ok: false, status: 400, error: 'That did not undo. Please try again.' }
  if (!back || back.length === 0) return { ok: false, status: 409, error: FORWARD_UNDO_TEXT.changed }

  const name = await actorName(admin, actor)
  await admin.from('application_follow_ups').update({ undone_at: now, undone_by: actor.id }).eq('id', fu.id as string)
  if (fu.forward_id) await admin.from('applicant_forwards').update({ undone_at: now, undone_by: actor.id }).eq('id', fu.forward_id as string)
  await admin.from('application_stage_events').insert({
    application_id: fu.application_id,
    job_id: fu.job_id,
    tutor_id: fu.tutor_id,
    from_stage: 'forwarded',
    to_stage: 'applied',
    staff_id: actor.id,
    staff_name: name,
  })
  // The tuition's history and the tutor's timeline: types and ids only.
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'application.stage',
    targetType: 'job',
    targetId: fu.job_id as string,
    detail: { applicationId: fu.application_id, tutorId: fu.tutor_id, from: 'forwarded', to: 'applied', reason: 'undo of the Applied message' },
  })
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'applicants.forward_undo',
    targetType: 'job',
    targetId: fu.job_id as string,
    detail: { forwardId: fu.forward_id, applicationId: fu.application_id, tutorId: fu.tutor_id },
  })
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'application.follow_up_undo',
    targetType: 'job',
    targetId: fu.job_id as string,
    detail: { applicationId: fu.application_id, tutorId: fu.tutor_id, stage: fu.stage, recipient: fu.recipient, kind: fu.kind },
  })
  await logActivity({
    userId: fu.tutor_id as string,
    event: 'application_stage_changed',
    targetType: 'application',
    targetId: fu.application_id as string,
    meta: { jobId: fu.job_id, from: 'forwarded', to: 'applied', stage: 'Applied', undo: true },
  })
  await logActivity({
    userId: fu.tutor_id as string,
    event: 'application_follow_up_undone',
    targetType: 'application',
    targetId: fu.application_id as string,
    meta: { jobId: fu.job_id, recipient: fu.recipient, kind: fu.kind, stage: 'applied' },
  })
  return { ok: true, undone: 1 }
}
