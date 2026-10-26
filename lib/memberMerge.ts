import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { chunk, pageAll } from '@/lib/pageAll'
import { formatName } from '@/lib/formatName'
import { deriveCnicStatus } from '@/lib/cnicStatus'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import type { AdminRole } from '@/lib/adminAccessCore'
import {
  DOC_COLUMNS,
  mergeBlock,
  planMerge,
  previewLines,
  suggestKeep,
  TUTOR_FILL,
  PROFILE_FILL,
  undoOps,
  type MergePlan,
  type MergeSide,
  type Op,
} from '@/lib/memberMergeCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>
type Actor = { id: string; adminRole: AdminRole; email: string | null }
type R = Record<string, unknown>

// Merging two accounts of the same person (owner, 26 Oct 2026; rules
// lib/memberMergeCore). Owner only — every route also asks for the password
// again. The plan is computed, stored on member_merges, then applied op by op;
// a failure part-way puts back what was applied. "Undo merge" writes every op's
// old values back, newest first. Both accounts' Activity tabs and Audit show it.

async function ids(admin: Admin, table: string, col: string, memberId: string, cols = 'id'): Promise<R[]> {
  return (await pageAll((a, b) => admin.from(table).select(cols).eq(col, memberId).order('id').range(a, b) as never)) as R[]
}

export async function loadMergeSide(admin: Admin, memberId: string): Promise<MergeSide | null> {
  const profileCols = ['id', 'role', 'admin_role', 'full_name', 'created_at', 'profile_completion', 'phone_number', 'secondary_phone', 'merged_into', 'hidden_from_public', ...PROFILE_FILL, ...DOC_COLUMNS]
  const { data: p } = await admin.from('profiles').select([...new Set(profileCols)].join(', ')).eq('id', memberId).maybeSingle()
  if (!p) return null
  const prof = p as unknown as R
  const isTutor = prof.role === 'tutor'
  const [{ data: tp }, docs, subj, areas, apps, afus, events, fus, notes, activity, jobs, pays, subs, { data: credit }] = await Promise.all([
    isTutor
      ? admin.from('tutor_profiles').select(['id', 'verified_fee_paid_at', ...TUTOR_FILL].join(', ')).eq('id', memberId).maybeSingle()
      : Promise.resolve({ data: null }),
    ids(admin, 'user_documents', 'user_id', memberId, 'id, kind'),
    isTutor ? (admin.from('tutor_subjects').select('master_id').eq('tutor_id', memberId) as unknown as Promise<{ data: R[] | null }>) : Promise.resolve({ data: [] as R[] }),
    isTutor ? ids(admin, 'tutor_areas', 'tutor_id', memberId, 'id, city, area') : Promise.resolve([] as R[]),
    isTutor ? ids(admin, 'applications', 'tutor_id', memberId, 'id, job_id') : Promise.resolve([] as R[]),
    isTutor ? ids(admin, 'application_follow_ups', 'tutor_id', memberId, 'id, application_id') : Promise.resolve([] as R[]),
    isTutor ? ids(admin, 'application_stage_events', 'tutor_id', memberId, 'id, application_id') : Promise.resolve([] as R[]),
    ids(admin, 'member_follow_ups', 'member_id', memberId),
    ids(admin, 'member_notes', 'member_id', memberId),
    ids(admin, 'user_activity_log', 'user_id', memberId),
    !isTutor ? ids(admin, 'jobs', 'parent_id', memberId) : Promise.resolve([] as R[]),
    ids(admin, 'payments', 'user_id', memberId, 'id, plan_code, status, refunded_at, provider_ref'),
    ids(admin, 'subscriptions', 'user_id', memberId, 'id, plan_code, status'),
    admin.from('staff_signup_credits').select('*').eq('member_id', memberId).maybeSingle(),
  ])
  // Subject names (for the 15-subject cap).
  const masterIds = ((subj.data ?? []) as R[]).map((r) => r.master_id as number)
  const nameOf = new Map<number, string>()
  for (const part of chunk(masterIds, 200)) {
    const { data: m } = await admin.from('taxonomy_master').select('id, subject_slug, level_slug').in('id', part)
    const slugs = [...new Set((m ?? []).map((x) => (x.subject_slug as string | null) ?? (x.level_slug as string)))]
    const { data: names } = slugs.length ? await admin.from('taxonomy_subjects').select('slug, name').in('slug', slugs) : { data: [] }
    const bySlug = new Map((names ?? []).map((n) => [n.slug as string, n.name as string]))
    for (const x of m ?? []) nameOf.set(x.id as number, bySlug.get((x.subject_slug as string | null) ?? '') ?? String(x.level_slug ?? x.id))
  }
  const docCols: R = {}
  for (const c of DOC_COLUMNS) docCols[c] = prof[c] ?? null
  const approved: string[] = []
  if (
    deriveCnicStatus({
      verification_state: prof.verification_state as string | null,
      cnic_verified_at: prof.cnic_verified_at as string | null,
      cnic_number: prof.cnic_number as string | null,
      cnic_image_path: prof.cnic_image_path as string | null,
    }) === 'approved'
  )
    approved.push('CNIC')
  if (String(prof.profile_pic_status ?? '') === 'approved') approved.push('Profile photo')
  if (String(prof.selfie_status ?? '') === 'approved') approved.push('Selfie')
  const profileFill: R = { hidden_from_public: prof.hidden_from_public ?? false }
  for (const c of PROFILE_FILL) profileFill[c] = prof[c] ?? null
  const tutorFill: R | null = tp ? Object.fromEntries(TUTOR_FILL.map((c) => [c, (tp as unknown as R)[c] ?? null])) : null
  return {
    id: memberId,
    role: (prof.role as string | null) ?? null,
    name: formatName(prof.full_name as string | null) || 'Member',
    joinedAt: prof.created_at as string,
    completion: Number(prof.profile_completion ?? 0),
    phone: (prof.phone_number as string | null) ?? null,
    secondaryPhone: (prof.secondary_phone as string | null) ?? null,
    mergedInto: (prof.merged_into as string | null) ?? null,
    isStaff: prof.role === 'admin' || !!prof.admin_role,
    profile: profileFill,
    tutor: tutorFill,
    docColumns: docCols,
    approvedDocs: approved,
    documents: docs.map((d) => ({ id: d.id as string, kind: d.kind as string })),
    subjects: masterIds.map((id) => ({ masterId: id, subject: nameOf.get(id) ?? String(id) })),
    areas: areas.map((a) => ({ id: a.id as string, city: (a.city as string) ?? '', area: (a.area as string) ?? '' })),
    applications: apps.map((a) => ({ id: a.id as string, jobId: a.job_id as string })),
    applicationFollowUps: afus.map((a) => ({ id: a.id as string, applicationId: (a.application_id as string | null) ?? null })),
    stageEvents: events.map((a) => ({ id: a.id as string, applicationId: (a.application_id as string | null) ?? null })),
    followUps: fus.map((x) => x.id as string),
    notes: notes.map((x) => x.id as string),
    activity: activity.map((x) => x.id as string),
    jobs: jobs.map((x) => x.id as string),
    payments: pays.map((x) => ({
      id: x.id as string,
      planCode: x.plan_code as string,
      status: x.status as string,
      refunded: !!x.refunded_at,
      ref: (x.provider_ref as string | null) ?? null,
    })),
    subscriptions: subs.map((x) => ({ id: x.id as string, planCode: x.plan_code as string, status: x.status as string })),
    feePaidAt: tp ? (((tp as unknown as R).verified_fee_paid_at as string | null) ?? null) : null,
    credit: (credit as R | null) ?? null,
  }
}

export type MergeSummary = {
  id: string
  name: string
  role: string | null
  joinedAt: string
  completion: number
  phoneMasked: string | null
  documents: { count: number; approved: string[] }
  payments: { approved: number; total: number }
  applications: number
  tuitions: number
}

function summary(s: MergeSide, mask: (p: string | null) => string | null): MergeSummary {
  return {
    id: s.id,
    name: s.name,
    role: s.role,
    joinedAt: s.joinedAt,
    completion: s.completion,
    phoneMasked: mask(s.phone),
    documents: { count: s.documents.length, approved: s.approvedDocs },
    payments: { approved: s.payments.filter((p) => p.status === 'approved' && !p.refunded).length, total: s.payments.length },
    applications: s.applications.length,
    tuitions: s.jobs.length,
  }
}

export type MergePreview =
  | { ok: true; a: MergeSummary; b: MergeSummary; suggestedKeep: string; keepId: string; block: string | null; lines: string[]; plan: MergePlan | null }
  | { ok: false; status: number; error: string }

export async function previewMerge(aId: string, bId: string, keepId: string | null, mask: (p: string | null) => string | null): Promise<MergePreview> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now.' }
  const [a, b] = await Promise.all([loadMergeSide(admin, aId), loadMergeSide(admin, bId)])
  if (!a || !b) return { ok: false, status: 404, error: 'One of these accounts was not found.' }
  const suggested = suggestKeep(a, b)
  const keep = keepId === b.id ? b : keepId === a.id ? a : suggested === a.id ? a : b
  const other = keep.id === a.id ? b : a
  const block = mergeBlock(keep, other)
  const plan = block ? null : planMerge(keep, other, new Date().toISOString())
  return { ok: true, a: summary(a, mask), b: summary(b, mask), suggestedKeep: suggested, keepId: keep.id, block, lines: plan ? previewLines(plan) : [], plan }
}

async function applyOp(admin: Admin, op: Op): Promise<string | null> {
  let q = admin.from(op.table).update(op.set)
  for (const [k, v] of Object.entries(op.match)) q = q.eq(k, v)
  const { error } = await q
  return error ? `${op.table}: ${error.message}` : null
}

async function applyAll(admin: Admin, ops: Op[]): Promise<{ applied: Op[]; error: string | null }> {
  const applied: Op[] = []
  for (const op of ops) {
    const err = await applyOp(admin, op)
    if (err) return { applied, error: err }
    applied.push(op)
  }
  return { applied, error: null }
}

async function record(actor: Actor, action: string, kept: MergeSide | { id: string; name: string }, merged: { id: string; name: string }, detail: R) {
  for (const [target, role] of [
    [kept.id, 'kept'],
    [merged.id, 'merged'],
  ] as const) {
    await logAdminAction({
      actorId: actor.id,
      actorRole: actor.adminRole,
      actorEmail: actor.email,
      action,
      targetType: 'profile',
      targetId: target,
      detail: { ...detail, keptId: kept.id, mergedId: merged.id, side: role },
    })
    await logActivity({
      userId: target,
      event: action === 'member.merge' ? 'account_merged' : 'account_merge_undone',
      targetType: 'profile',
      targetId: role === 'kept' ? merged.id : kept.id,
      meta: { side: role },
    })
  }
}

export async function applyMerge(actor: Actor, keepId: string, otherId: string): Promise<{ ok: true; mergeId: string; lines: string[] } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now.' }
  const [keep, other] = await Promise.all([loadMergeSide(admin, keepId), loadMergeSide(admin, otherId)])
  if (!keep || !other) return { ok: false, status: 404, error: 'One of these accounts was not found.' }
  const block = mergeBlock(keep, other)
  if (block) return { ok: false, status: 409, error: block }
  const plan = planMerge(keep, other, new Date().toISOString())
  const { data: row, error: insErr } = await admin
    .from('member_merges')
    .insert({ kept_id: keep.id, merged_id: other.id, merged_by: actor.id, status: 'applying', log: { ops: plan.ops, report: plan.report } })
    .select('id')
    .single()
  if (insErr || !row) return { ok: false, status: 400, error: 'The merge could not start. Please try again.' }
  const mergeId = row.id as string
  const { applied, error } = await applyAll(admin, plan.ops)
  if (error) {
    // Put back what was applied, newest first.
    await applyAll(admin, undoOps(applied))
    await admin.from('member_merges').update({ status: 'failed', error: error.slice(0, 300) }).eq('id', mergeId)
    return { ok: false, status: 500, error: 'The merge did not finish and nothing was changed. Please try again.' }
  }
  await admin.from('member_merges').update({ status: 'done' }).eq('id', mergeId)
  // Sign the merged account out everywhere.
  await admin.rpc('revoke_user_sessions', { uid: other.id })
  await record(actor, 'member.merge', keep, other, { mergeId, report: plan.report })
  return { ok: true, mergeId, lines: previewLines(plan) }
}

export async function undoMerge(actor: Actor, mergeId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now.' }
  const { data: m } = await admin.from('member_merges').select('id, kept_id, merged_id, status, undone_at, log').eq('id', mergeId).maybeSingle()
  if (!m) return { ok: false, status: 404, error: 'That merge was not found.' }
  if (m.undone_at) return { ok: true }
  if (m.status !== 'done') return { ok: false, status: 409, error: 'That merge did not finish, so there is nothing to undo.' }
  const ops = ((m.log as { ops?: Op[] } | null)?.ops ?? []) as Op[]
  const { applied, error } = await applyAll(admin, undoOps(ops))
  if (error) {
    // Re-apply what was undone, so the accounts are left as merged.
    await applyAll(admin, undoOps(applied))
    return { ok: false, status: 500, error: 'The undo did not finish and nothing was changed. Please try again.' }
  }
  await admin.from('member_merges').update({ undone_at: new Date().toISOString(), undone_by: actor.id }).eq('id', mergeId)
  await record(actor, 'member.merge_undo', { id: m.kept_id as string, name: '' }, { id: m.merged_id as string, name: '' }, { mergeId })
  return { ok: true }
}

/** The latest live merge an account is part of (for "Undo merge"). */
export async function liveMergeFor(admin: Admin, memberId: string): Promise<{ id: string; keptId: string; mergedId: string; at: string } | null> {
  const { data } = await admin
    .from('member_merges')
    .select('id, kept_id, merged_id, created_at')
    .or(`kept_id.eq.${memberId},merged_id.eq.${memberId}`)
    .eq('status', 'done')
    .is('undone_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
  const r = (data ?? [])[0]
  return r ? { id: r.id as string, keptId: r.kept_id as string, mergedId: r.merged_id as string, at: r.created_at as string } : null
}
