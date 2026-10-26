// lib/journey.ts
//
// The I/O half of the Activity tab (owner, 23 Oct 2026; rules in
// lib/journeyCore). Reads every record about ONE member and turns each into a
// plain line with a time and who did it. Service role; the page and the routes
// check SCREEN_ACCESS.memberActivity first. Nothing is written here except the
// notes (logNote / withdrawNote), which are audited.
//
// Never selected for a line: a phone number, a CNIC number, an email, an
// amount, or any message text.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll } from '@/lib/pageAll'
import { formatName } from '@/lib/formatName'
import { logAdminAction } from '@/lib/auditLog'
import type { AdminActor } from '@/lib/adminAuth'
import { auditSentence } from '@/lib/memberTimelineCore'
import { paymentPlanName } from '@/lib/paymentLabelCore'
import { staffLabel } from '@/lib/followUpCore'
import { fuTemplateDef, FOLLOW_REASON_LABEL, isFollowReason } from '@/lib/followUpTemplatesCore'
import { appTemplateDef } from '@/lib/applicationTemplatesCore'
import { OUTCOME_LABEL, type ContactOutcome } from '@/lib/staffOutreachCore'
import {
  buildJourney,
  docName,
  journeyCounts,
  latestAt,
  noteProblem,
  noteText,
  stageWord,
  tm,
  withdrawProblem,
  type JourneyCounts,
  type JourneyLine,
  type NoteKind,
  type RawLine,
} from '@/lib/journeyCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>
type R = Record<string, unknown>
type Page = Promise<{ data: R[] | null; error: { message: string } | null }>

/** Admin actions shown on the Activity tab (the rest are on the member page's
 *  Timeline): decisions on documents, pauses, bans, account type changes. */
const AUDIT_ACTIONS = new Set([
  'tutor.approve',
  'tutor.hold',
  'parent.verify.approve',
  'parent.verify.reject',
  'document.unlock',
  'member.warn',
  'member.suspend',
  'member.unsuspend',
  'member.ban',
  'member.unban',
  'member.convert_role',
  'member.not_interested',
  'member.not_interested_undo',
  'plan.grant',
  'plan.revoke',
  // Merges and View as (owner, 26 Oct 2026).
  'member.merge',
  'member.merge_undo',
  'member.view_as_start',
  'member.view_as_end',
])

const kindOfAudit = (a: string): RawLine['kind'] => {
  if (a === 'tutor.approve' || a === 'parent.verify.approve') return 'doc_approved'
  if (a === 'tutor.hold' || a === 'parent.verify.reject') return 'doc_rejected'
  if (a === 'member.convert_role') return 'account_type'
  if (a === 'member.suspend' || a === 'member.unsuspend') return 'pause'
  return 'moderation'
}

const ROLE_WORD: Record<string, string> = { tutor: 'Tutor', parent: 'Parent' }

function auditText(action: string, detail: R | null): string {
  if (action === 'member.convert_role') {
    const from = ROLE_WORD[String(detail?.from ?? '')] ?? 'another'
    const to = ROLE_WORD[String(detail?.to ?? '')] ?? 'another'
    return `Account type changed from ${from} to ${to}`
  }
  if (action === 'member.suspend') return 'Account paused by staff'
  if (action === 'member.unsuspend') return 'Account reinstated by staff'
  if (action === 'member.not_interested') return 'Marked "Not interested" on Follow-ups'
  if (action === 'member.not_interested_undo') return '"Not interested" undone'
  if (action === 'member.merge') return detail?.side === 'merged' ? 'Merged into another account' : 'Another account was merged into this one'
  if (action === 'member.merge_undo') return 'Merge undone'
  if (action === 'member.view_as_start') return 'The Owner viewed this account as the member (read only)'
  if (action === 'member.view_as_end') return 'The Owner stopped viewing this account'
  return auditSentence(action, detail)
}

/** A follow-up's message, in words: the template title, else its reason. */
function followUpText(templateKey: string | null, reason: string | null, channel: string, titles: Map<string, string>): string {
  if (channel === 'call') return 'Marked as followed up (call or other contact)'
  const title = (templateKey && (titles.get(templateKey) || fuTemplateDef(templateKey)?.title || appTemplateDef(templateKey)?.title)) || null
  if (title) return `WhatsApp sent: “${title}”`
  if (reason && isFollowReason(reason)) return `WhatsApp sent about: ${FOLLOW_REASON_LABEL[reason].toLowerCase()}`
  return 'WhatsApp follow-up sent'
}

async function staffNames(admin: Admin, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const list = [...new Set(ids.filter(Boolean))]
  if (list.length === 0) return out
  const { data } = await admin.from('profiles').select('id, full_name').in('id', list)
  for (const p of data ?? []) out.set(p.id as string, formatName(p.full_name as string | null) || 'Staff')
  return out
}

export type Journey = {
  role: 'tutor' | 'parent' | 'other'
  lines: JourneyLine[]
  /** Tutors: the summary strip. */
  paidAt: string | null
  counts: JourneyCounts | null
  lastContactAt: string | null
  /** Parents: tuitions posted. */
  tuitions: number
}

const pageRows = (q: (from: number, to: number) => PromiseLike<unknown>) => pageAll<R>(q as (from: number, to: number) => Page)

/** Every line of one member's Activity tab, newest first. */
export async function loadJourney(memberId: string): Promise<Journey | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data: p } = await admin.from('profiles').select('id, role, created_at').eq('id', memberId).maybeSingle()
  if (!p) return null
  const role = p.role === 'tutor' ? 'tutor' : p.role === 'parent' ? 'parent' : 'other'
  const lines: RawLine[] = [{ id: `signup:${memberId}`, at: p.created_at as string, kind: 'signed_up', text: 'Signed up', by: null }]

  // ---- shared: the member's own events, follow-ups, calls, notes, audit ----
  const [events, fus, calls, notes, audits, templates, tutorRow] = await Promise.all([
    pageRows((f, t) =>
      admin
        .from('user_activity_log')
        .select('id, event, created_at')
        .eq('user_id', memberId)
        .in('event', ['email_confirmed', 'otp_verified', 'onboarding_done', 'profile_updated', 'subjects_changed', 'account_self_paused', 'account_self_restored'])
        .order('id')
        .range(f, t),
    ),
    pageRows((f, t) =>
      admin
        .from('member_follow_ups')
        .select('id, channel, template_key, reason, staff_id, staff_name, created_at')
        .eq('member_id', memberId)
        .is('undone_at', null)
        .order('id')
        .range(f, t),
    ),
    pageRows((f, t) => admin.from('tutor_contact_logs').select('id, outcome, staff_id, created_at').eq('tutor_id', memberId).order('id').range(f, t)),
    pageRows((f, t) =>
      admin
        .from('member_notes')
        .select('id, kind, body, staff_name, created_at, withdrawn_at, withdrawn_by_name, withdrawn_reason')
        .eq('member_id', memberId)
        .order('id')
        .range(f, t),
    ),
    pageRows((f, t) =>
      admin
        .from('admin_audit_log')
        .select('id, action, detail, actor_id, created_at')
        .eq('target_id', memberId)
        .in('action', [...AUDIT_ACTIONS])
        .order('id')
        .range(f, t),
    ),
    admin.from('admin_message_templates').select('key, title'),
    admin.from('tutor_profiles').select('verified_fee_paid_at').eq('id', memberId).maybeSingle(),
  ])
  const titles = new Map(((templates.data ?? []) as R[]).map((r) => [r.key as string, (r.title as string) ?? '']))

  // Profile edits are many small saves: one line per day.
  const editsByDay = new Map<string, { at: string; n: number }>()
  for (const e of events) {
    const ev = e.event as string
    const at = e.created_at as string
    if (ev === 'profile_updated' || ev === 'subjects_changed') {
      const day = at.slice(0, 10)
      const cur = editsByDay.get(day)
      if (!cur) editsByDay.set(day, { at, n: 1 })
      else editsByDay.set(day, { at: at > cur.at ? at : cur.at, n: cur.n + 1 })
      continue
    }
    const text =
      ev === 'email_confirmed'
        ? 'Email confirmed'
        : ev === 'otp_verified'
          ? 'Mobile verified'
          : ev === 'onboarding_done'
            ? 'Finished every profile step'
            : ev === 'account_self_paused'
              ? 'Paused their own account'
              : 'Came back and un-paused their account'
    lines.push({ id: `ev:${e.id}`, at, kind: ev.startsWith('account_self') ? 'pause' : 'step', text, by: ev.startsWith('account_self') ? 'Themselves' : null })
  }
  for (const [day, v] of editsByDay)
    lines.push({ id: `edits:${day}`, at: v.at, kind: 'step', text: `Edited their profile (${v.n} ${v.n === 1 ? 'save' : 'saves'})`, by: null })

  const ids = [
    ...fus.map((r) => r.staff_id as string),
    ...calls.map((r) => r.staff_id as string),
    ...audits.map((r) => r.actor_id as string),
  ]
  const names = await staffNames(admin, ids)
  for (const r of fus)
    lines.push({
      id: `fu:${r.id}`,
      at: r.created_at as string,
      kind: 'follow_up',
      text: followUpText((r.template_key as string | null) ?? null, (r.reason as string | null) ?? null, r.channel as string, titles),
      by: (r.staff_id ? names.get(r.staff_id as string) : undefined) || staffLabel(r.staff_name as string | null, null),
    })
  for (const r of calls)
    lines.push({
      id: `call:${r.id}`,
      at: r.created_at as string,
      kind: 'call',
      text: `Call logged: ${OUTCOME_LABEL[r.outcome as ContactOutcome] ?? 'contact'}`,
      by: (r.staff_id ? names.get(r.staff_id as string) : undefined) || 'Staff',
    })
  for (const r of notes)
    lines.push({
      id: `note:${r.id}`,
      at: r.created_at as string,
      kind: 'note',
      text: noteText(r.kind as NoteKind, r.body as string),
      by: staffLabel(r.staff_name as string | null, null),
      noteId: r.id as string,
      withdrawn: r.withdrawn_at
        ? { at: r.withdrawn_at as string, by: (r.withdrawn_by_name as string | null) ?? null, reason: (r.withdrawn_reason as string | null) ?? '' }
        : null,
    })
  for (const r of audits) {
    const action = r.action as string
    lines.push({
      id: `audit:${r.id}`,
      at: r.created_at as string,
      kind: kindOfAudit(action),
      text: auditText(action, (r.detail as R | null) ?? null),
      by: r.actor_id ? (names.get(r.actor_id as string) ?? 'Staff') : null,
    })
  }

  // ---- payments (never an amount) ----
  const payments = await pageRows((f, t) =>
    admin
      .from('payments')
      .select('id, plan_code, status, provider, created_at, reviewed_at, refunded_at, checkout_closed_at, screenshot_path')
      .eq('user_id', memberId)
      .order('id')
      .range(f, t),
  )
  for (const pay of payments) {
    const name = paymentPlanName(pay.plan_code as string | null)
    const viaBank = pay.provider === 'manual'
    lines.push({
      id: `pay:${pay.id}`,
      at: pay.created_at as string,
      kind: 'payment_started',
      text: `${viaBank ? 'Bank transfer started' : 'Payment started'}: ${name}`,
      by: null,
    })
    if (pay.status === 'approved' && pay.reviewed_at)
      lines.push({ id: `paid:${pay.id}`, at: pay.reviewed_at as string, kind: 'paid', text: `Paid: ${name}`, by: null })
    if (pay.status === 'rejected')
      lines.push({ id: `fail:${pay.id}`, at: (pay.reviewed_at as string) || (pay.created_at as string), kind: 'payment_failed', text: `Payment not approved: ${name}`, by: null })
    if (pay.refunded_at) lines.push({ id: `refund:${pay.id}`, at: pay.refunded_at as string, kind: 'refunded', text: `Refunded: ${name}`, by: null })
  }

  // ---- documents ----
  const docs = await pageRows((f, t) => admin.from('user_documents').select('id, kind, created_at').eq('user_id', memberId).order('id').range(f, t))
  for (const d of docs)
    lines.push({ id: `doc:${d.id}`, at: d.created_at as string, kind: 'doc_submitted', text: `Uploaded: ${docName(d.kind as string)}`, by: null })

  let counts: JourneyCounts | null = null
  let tuitions = 0
  const contactTimes: (string | null)[] = [
    ...fus.map((r) => r.created_at as string),
    ...calls.map((r) => r.created_at as string),
    ...notes.filter((n) => !n.withdrawn_at).map((n) => n.created_at as string),
  ]

  if (role === 'tutor') {
    const tut = await tutorLines(admin, memberId)
    lines.push(...tut.lines)
    counts = tut.counts
    contactTimes.push(...tut.contactTimes)
  } else if (role === 'parent') {
    const par = await parentLines(admin, memberId)
    lines.push(...par.lines)
    tuitions = par.tuitions
  }

  return {
    role,
    lines: buildJourney(lines),
    paidAt: (tutorRow.data?.verified_fee_paid_at as string | null) ?? null,
    counts,
    lastContactAt: latestAt(contactTimes),
    tuitions,
  }
}

async function jobRefs(admin: Admin, jobIds: string[]): Promise<Map<string, { ref: string | null; parentId: string | null; createdAt: string | null }>> {
  const out = new Map<string, { ref: string | null; parentId: string | null; createdAt: string | null }>()
  const list = [...new Set(jobIds.filter(Boolean))]
  for (let i = 0; i < list.length; i += 200) {
    const { data } = await admin.from('jobs').select('id, ref_id, parent_id, created_at').in('id', list.slice(i, i + 200))
    for (const j of data ?? [])
      out.set(j.id as string, { ref: (j.ref_id as string | null) ?? null, parentId: (j.parent_id as string | null) ?? null, createdAt: (j.created_at as string | null) ?? null })
  }
  return out
}

async function tutorLines(admin: Admin, tutorId: string) {
  const lines: RawLine[] = []
  const [apps, events, appFus, forwards] = await Promise.all([
    pageRows((f, t) =>
      admin
        .from('applications')
        .select('id, job_id, stage, stage_changed_at, stage_changed_by_name, created_at, withdrawn_at')
        .eq('tutor_id', tutorId)
        .order('id')
        .range(f, t),
    ),
    pageRows((f, t) =>
      admin.from('application_stage_events').select('id, application_id, job_id, from_stage, to_stage, staff_name, created_at').eq('tutor_id', tutorId).order('id').range(f, t),
    ),
    pageRows((f, t) =>
      admin
        .from('application_follow_ups')
        .select('id, application_id, job_id, kind, recipient, message_key, staff_name, created_at')
        .eq('tutor_id', tutorId)
        .is('undone_at', null)
        .order('id')
        .range(f, t),
    ),
    pageRows((f, t) =>
      admin.from('applicant_forwards').select('id, job_id, tutor_ids, staff_name, created_at').contains('tutor_ids', [tutorId]).is('undone_at', null).order('id').range(f, t),
    ),
  ])
  const refs = await jobRefs(admin, [...apps.map((a) => a.job_id as string), ...forwards.map((f) => f.job_id as string)])
  const ref = (jobId: unknown) => tm(refs.get(jobId as string)?.ref)

  for (const a of apps) {
    lines.push({ id: `app:${a.id}`, at: a.created_at as string, kind: 'applied', text: `Applied to ${ref(a.job_id)}`, by: 'The tutor' })
    if (a.withdrawn_at) lines.push({ id: `wd:${a.id}`, at: a.withdrawn_at as string, kind: 'withdrawn', text: `Withdrew from ${ref(a.job_id)}`, by: 'The tutor' })
  }
  const withEvent = new Set(events.map((e) => e.application_id as string))
  for (const e of events) {
    const hired = e.to_stage === 'hired'
    lines.push({
      id: `stage:${e.id}`,
      at: e.created_at as string,
      kind: hired ? 'hired' : 'stage',
      text: hired ? `Hired for ${ref(e.job_id)}` : `${ref(e.job_id)}: ${stageWord(e.from_stage as string)} → ${stageWord(e.to_stage as string)}`,
      by: (e.staff_name as string | null) ?? null,
    })
  }
  // A stage moved before stage changes were recorded: one line from the application itself.
  for (const a of apps) {
    if (a.stage === 'applied' || withEvent.has(a.id as string) || !a.stage_changed_at) continue
    const hired = a.stage === 'hired'
    lines.push({
      id: `stagerec:${a.id}`,
      at: a.stage_changed_at as string,
      kind: hired ? 'hired' : 'stage',
      text: hired ? `Hired for ${ref(a.job_id)}` : `${ref(a.job_id)}: moved to ${stageWord(a.stage as string)}`,
      by: (a.stage_changed_by_name as string | null) ?? null,
    })
  }
  for (const f of forwards)
    lines.push({ id: `fwd:${f.id}`, at: f.created_at as string, kind: 'forwarded', text: `Forwarded to the parent for ${ref(f.job_id)}`, by: staffLabel(f.staff_name as string | null, null) })
  // Tutor check-ins (By tutor) are one message listing several applications:
  // one line per send.
  const checkIns = new Map<string, R>()
  for (const r of appFus) {
    if (r.kind === 'tutor_update') {
      const k = `${r.created_at}|${r.staff_name}`
      if (!checkIns.has(k)) checkIns.set(k, r)
      continue
    }
    const toTutor = r.recipient === 'tutor'
    lines.push({
      id: `appfu:${r.id}`,
      at: r.created_at as string,
      kind: toTutor ? 'check_in' : 'parent_follow_up',
      text: toTutor ? `Update sent to the tutor about ${ref(r.job_id)}` : `Parent followed up about ${ref(r.job_id)}`,
      by: staffLabel(r.staff_name as string | null, null),
    })
  }
  for (const r of checkIns.values())
    lines.push({ id: `checkin:${r.id}`, at: r.created_at as string, kind: 'check_in', text: 'Check-in sent to the tutor (all applications)', by: staffLabel(r.staff_name as string | null, null) })

  const forwardedJobs = new Set(forwards.map((f) => f.job_id as string))
  const live = apps.filter((a) => !a.withdrawn_at)
  const counts = journeyCounts(
    live.map((a) => ({ jobId: a.job_id as string, stage: a.stage as string, createdAt: a.created_at as string })),
    forwardedJobs,
  )
  const contactTimes = appFus.filter((r) => r.recipient === 'tutor').map((r) => r.created_at as string)
  return { lines, counts, contactTimes }
}

async function parentLines(admin: Admin, parentId: string) {
  const lines: RawLine[] = []
  const jobs = await pageRows((f, t) => admin.from('jobs').select('id, ref_id, created_at').eq('parent_id', parentId).order('id').range(f, t))
  const jobIds = jobs.map((j) => j.id as string)
  const refOf = new Map(jobs.map((j) => [j.id as string, (j.ref_id as string | null) ?? null]))
  for (const j of jobs) lines.push({ id: `job:${j.id}`, at: j.created_at as string, kind: 'tuition_posted', text: `Posted ${tm(j.ref_id as string | null)}`, by: null })
  if (jobIds.length) {
    const inJobs = async (table: string, cols: string) => {
      const out: R[] = []
      for (let i = 0; i < jobIds.length; i += 100) {
        const { data } = await admin.from(table).select(cols).in('job_id', jobIds.slice(i, i + 100))
        out.push(...((data ?? []) as unknown as R[]))
      }
      return out
    }
    const [forwards, fus, events] = await Promise.all([
      inJobs('applicant_forwards', 'id, job_id, tutor_ids, staff_name, created_at, undone_at'),
      inJobs('application_follow_ups', 'id, job_id, recipient, staff_name, created_at, undone_at'),
      inJobs('application_stage_events', 'id, job_id, to_stage, staff_name, created_at'),
    ])
    for (const f of forwards) {
      if (f.undone_at) continue
      const n = Array.isArray(f.tutor_ids) ? (f.tutor_ids as unknown[]).length : 0
      lines.push({
        id: `fwd:${f.id}`,
        at: f.created_at as string,
        kind: 'forwarded',
        text: `${n} ${n === 1 ? 'tutor' : 'tutors'} forwarded for ${tm(refOf.get(f.job_id as string))}`,
        by: staffLabel(f.staff_name as string | null, null),
      })
    }
    for (const r of fus) {
      if (r.undone_at || r.recipient !== 'parent') continue
      lines.push({ id: `appfu:${r.id}`, at: r.created_at as string, kind: 'parent_follow_up', text: `Followed up about ${tm(refOf.get(r.job_id as string))}`, by: staffLabel(r.staff_name as string | null, null) })
    }
    for (const e of events) {
      if (e.to_stage !== 'hired') continue
      lines.push({ id: `stage:${e.id}`, at: e.created_at as string, kind: 'hired', text: `Hired a tutor for ${tm(refOf.get(e.job_id as string))}`, by: (e.staff_name as string | null) ?? null })
    }
  }
  return { lines, tuitions: jobs.length }
}

// ---------------------------------------------------------------------- notes

const NOT_WORKING = 'This is not working right now. Please try again in a few minutes.'

export async function logNote(actor: AdminActor, memberId: string, kind: NoteKind, body: string): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
  const problem = noteProblem(body)
  if (problem) return { ok: false, status: 400, error: problem }
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_WORKING }
  const { data: member } = await admin.from('profiles').select('id').eq('id', memberId).maybeSingle()
  if (!member) return { ok: false, status: 404, error: 'That member was not found.' }
  const { data: me } = await admin.from('profiles').select('full_name').eq('id', actor.id).maybeSingle()
  const { data, error } = await admin
    .from('member_notes')
    .insert({ member_id: memberId, kind, body: body.trim(), staff_id: actor.id, staff_name: formatName(me?.full_name as string | null) || null })
    .select('id')
    .single()
  if (error || !data) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  // The note's words are never in the audit log or the member's own events.
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'member.note',
    targetType: 'profile',
    targetId: memberId,
    detail: { noteId: data.id, kind },
  })
  return { ok: true, id: data.id as string }
}

export async function withdrawNote(actor: AdminActor, noteId: string, reason: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const problem = withdrawProblem(reason)
  if (problem) return { ok: false, status: 400, error: problem }
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_WORKING }
  const { data: note } = await admin.from('member_notes').select('id, member_id, withdrawn_at').eq('id', noteId).maybeSingle()
  if (!note) return { ok: false, status: 404, error: 'That note was not found.' }
  if (note.withdrawn_at) return { ok: false, status: 409, error: 'That note was already withdrawn.' }
  const { data: me } = await admin.from('profiles').select('full_name').eq('id', actor.id).maybeSingle()
  const { error } = await admin
    .from('member_notes')
    .update({ withdrawn_at: new Date().toISOString(), withdrawn_by: actor.id, withdrawn_by_name: formatName(me?.full_name as string | null) || null, withdrawn_reason: reason.trim() })
    .eq('id', noteId)
    .is('withdrawn_at', null)
  if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'member.note_withdraw',
    targetType: 'profile',
    targetId: note.member_id as string,
    detail: { noteId },
  })
  return { ok: true }
}
