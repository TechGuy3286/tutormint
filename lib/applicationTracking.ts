// lib/applicationTracking.ts
//
// The server half of application tracking (owner, 22 Oct 2026; rules in
// lib/applicationStageCore). Staff only, except tutorApplicationCards (the
// tutor's own applications, read by their dashboard).
//
// Who counts: every application not withdrawn, from a tutor the People page
// does not leave out (staff, seed, team, test-named, hidden — an applicant has
// always paid the fee, so has activity, so "staff-linked without activity"
// never applies).
//
// Phones: only ever MASKED (0321•••••22) in anything this file returns. The
// WhatsApp check-in is built by /api/admin/applications/whatsapp, which sends
// the browser to wa.me without the number reaching the page.

import 'server-only'

import { cache } from 'react'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll, pageAllIn } from '@/lib/pageAll'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import type { AdminActor } from '@/lib/adminAuth'
import { formatName } from '@/lib/formatName'
import { maskMobile } from '@/lib/smsHealthCore'
import { tuitionPath } from '@/lib/slugs'
import { maskTuitionText } from '@/lib/maskTuition'
import { loadSocialEligibleTutors } from '@/lib/social/eligibility'
import { normalisePkMobile } from '@/lib/phone'
import { loadFollowUps, parentContacts } from '@/lib/applicationFollowUps'
import { dueState, todoBadgeCount, type FollowUpRecord } from '@/lib/applicationFollowUpCore'
import {
  ENDED_STAGES,
  isOpenStage,
  mayEditStage,
  mayReassign,
  otherOpenOnJob,
  STAGE_LABEL,
  tallyStages,
  type BoardItem,
  type Stage,
  type StageTally,
} from '@/lib/applicationStageCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

type AppRow = {
  id: string
  job_id: string
  tutor_id: string
  stage: Stage
  stage_changed_at: string | null
  stage_changed_by_name: string | null
  created_at: string
  withdrawn_at: string | null
  worked_at: string | null
  worked_by_name: string | null
}

type TutorFlags = {
  id: string
  role: string | null
  is_seed: boolean | null
  is_team_account: boolean | null
  is_test_name: boolean | null
  hidden_from_public: boolean | null
}

/** The People rule, for an applicant. */
export function applicantExcluded(p: TutorFlags | undefined): boolean {
  if (!p) return true
  return p.role === 'admin' || !!p.is_seed || !!p.is_team_account || !!p.is_test_name || !!p.hidden_from_public
}

const APP_COLS = 'id, job_id, tutor_id, stage, stage_changed_at, stage_changed_by_name, created_at, withdrawn_at, worked_at, worked_by_name'
const FLAG_COLS = 'id, role, is_seed, is_team_account, is_test_name, hidden_from_public'

/** Every counted application, with the tuition's owner. */
async function loadCounted(admin: Admin, jobIds?: string[]) {
  const apps = jobIds
    ? await pageAllIn<AppRow, string>(jobIds, (ids, from, to) =>
        admin.from('applications').select(APP_COLS).in('job_id', ids).order('id').range(from, to),
      )
    : await pageAll<AppRow>((from, to) => admin.from('applications').select(APP_COLS).order('id').range(from, to))
  const live = apps.filter((a) => !a.withdrawn_at && a.job_id)
  const tutorIds = [...new Set(live.map((a) => a.tutor_id))]
  const flags = await pageAllIn<TutorFlags, string>(tutorIds, (ids, from, to) =>
    admin.from('profiles').select(FLAG_COLS).in('id', ids).order('id').range(from, to),
  )
  const flagBy = new Map(flags.map((f) => [f.id, f]))
  const counted = live.filter((a) => !applicantExcluded(flagBy.get(a.tutor_id)))
  const countedJobs = [...new Set(counted.map((a) => a.job_id))]
  const [owners, posted] = await Promise.all([
    loadOwners(admin, countedJobs),
    pageAllIn<{ id: string; created_at: string }, string>(countedJobs, (ids, from, to) =>
      admin.from('jobs').select('id, created_at').in('id', ids).order('id').range(from, to),
    ),
  ])
  const jobCreated = new Map(posted.map((j) => [j.id, j.created_at]))
  return { counted, owners, jobCreated }
}

async function loadOwners(admin: Admin, jobIds: string[]): Promise<Map<string, string | null>> {
  const rows = await pageAllIn<{ job_id: string; staff_id: string | null }, string>(jobIds, (ids, from, to) =>
    admin.from('tuition_owners').select('job_id, staff_id').in('job_id', ids).order('job_id').range(from, to),
  )
  return new Map(rows.map((r) => [r.job_id, r.staff_id]))
}

const toItem = (a: AppRow, owners: Map<string, string | null>, jobCreated: Map<string, string>): BoardItem => ({
  id: a.id,
  stage: a.stage,
  stageChangedAt: a.stage_changed_at,
  ownerId: owners.get(a.job_id) ?? null,
  createdAt: a.created_at,
  workedAt: a.worked_at,
  jobCreatedAt: jobCreated.get(a.job_id) ?? null,
})

/** The Follow-ups red badge for this staff member. Tolerant — 0 on any failure. */
export const overdueApplicationsCount = cache(async (actor: AdminActor): Promise<number> => {
  const admin = createAdminClient()
  if (!admin) return 0
  try {
    const { counted, owners, jobCreated } = await loadCounted(admin)
    // Applications v3 (owner, 22 Oct 2026): overdue To do items only.
    const fus = await loadFollowUps(admin, counted.map((a) => a.id))
    const now = Date.now()
    return todoBadgeCount(
      counted.map((a) => {
        const item = toItem(a, owners, jobCreated)
        return { ...item, due: dueState(item, fus.get(a.id) ?? [], now) }
      }),
      actor,
    )
  } catch {
    return 0
  }
})

// ------------------------------------------------------------------ board ----

export type BoardRow = BoardItem & {
  jobId: string
  tutorId: string
  tutorName: string
  tutorSlug: string | null
  /** 0321•••••22 — never the full number. */
  tutorPhone: string | null
  /** Passes the Social posts rule — the Success story button needs it. */
  tutorVerified: boolean
  jobRef: string | null
  jobTitle: string
  jobCity: string | null
  jobPath: string | null
  ownerName: string | null
  stageChangedByName: string | null
  workedByName: string | null
  /** Follow-ups not undone (v3) — recipient type and message key only, no numbers. */
  followUps: FollowUpRecord[]
  /** The tuition has a usable parent number (the number itself never leaves the server). */
  hasParentNumber: boolean
}

export type StaffOption = { id: string; name: string }

export type ApplicationBoard = {
  rows: BoardRow[]
  staff: StaffOption[]
  /** Every owner's name (former staff included), for the Staff dropdown. */
  ownerNames: Record<string, string>
}

export async function loadApplicationBoard(): Promise<ApplicationBoard> {
  const admin = createAdminClient()
  if (!admin) return { rows: [], staff: [], ownerNames: {} }
  const { counted, owners, jobCreated } = await loadCounted(admin)
  const tutorIds = [...new Set(counted.map((a) => a.tutor_id))]
  const jobIds = [...new Set(counted.map((a) => a.job_id))]

  const [people, tps, jobs, staff, eligible, fus, parents] = await Promise.all([
    pageAllIn<{ id: string; full_name: string | null; phone_number: string | null; whatsapp: string | null }, string>(tutorIds, (ids, from, to) =>
      admin.from('profiles').select('id, full_name, phone_number, whatsapp').in('id', ids).order('id').range(from, to),
    ),
    pageAllIn<{ id: string; slug: string | null }, string>(tutorIds, (ids, from, to) =>
      admin.from('tutor_profiles').select('id, slug').in('id', ids).order('id').range(from, to),
    ),
    pageAllIn<{ id: string; ref_id: string | null; title: string | null; city: string | null; public_slug: string | null; job_tx_id: string | null }, string>(
      jobIds,
      (ids, from, to) => admin.from('jobs').select('id, ref_id, title, city, public_slug, job_tx_id').in('id', ids).order('id').range(from, to),
    ),
    loadStaffOptions(admin),
    loadSocialEligibleTutors(admin).catch(() => new Map()),
    loadFollowUps(admin, counted.map((a) => a.id)),
    parentContacts(admin, jobIds),
  ])
  const personBy = new Map(people.map((p) => [p.id, p]))
  const slugBy = new Map(tps.map((t) => [t.id, t.slug]))
  const jobBy = new Map(jobs.map((j) => [j.id, j]))
  const staffName = new Map(staff.map((s) => [s.id, s.name]))
  // An owner who is no longer on the team still shows by name.
  const missingOwners = [...new Set([...owners.values()].filter((v): v is string => !!v && !staffName.has(v)))]
  if (missingOwners.length) {
    const extra = await pageAllIn<{ id: string; full_name: string | null }, string>(missingOwners, (ids, from, to) =>
      admin.from('profiles').select('id, full_name').in('id', ids).order('id').range(from, to),
    )
    for (const p of extra) staffName.set(p.id, formatName(p.full_name) || 'Former staff')
  }

  const rows: BoardRow[] = counted.map((a) => {
    const p = personBy.get(a.tutor_id)
    const j = jobBy.get(a.job_id)
    const owner = owners.get(a.job_id) ?? null
    const phone = p?.whatsapp || p?.phone_number || null
    return {
      ...toItem(a, owners, jobCreated),
      jobId: a.job_id,
      tutorId: a.tutor_id,
      tutorName: formatName(p?.full_name) || 'Tutor',
      tutorSlug: slugBy.get(a.tutor_id) ?? null,
      tutorPhone: phone ? maskMobile(phone) : null,
      tutorVerified: eligible.has(a.tutor_id),
      jobRef: j?.ref_id ?? null,
      jobTitle: (j?.title ?? '').trim() || 'Tuition',
      jobCity: j?.city ?? null,
      jobPath: j ? tuitionPath({ public_slug: j.public_slug, city: j.city, job_tx_id: j.job_tx_id, id: j.id }) : null,
      ownerName: owner ? (staffName.get(owner) ?? 'Former staff') : null,
      stageChangedByName: a.stage_changed_by_name,
      workedByName: a.worked_by_name,
      followUps: fus.get(a.id) ?? [],
      hasParentNumber: !!normalisePkMobile(parents.get(a.job_id)?.raw ?? null),
    }
  })
  return { rows, staff, ownerNames: Object.fromEntries(staffName) }
}

/** Staff who may own a tuition: every staff role, not suspended. */
export async function loadStaffOptions(admin: Admin): Promise<StaffOption[]> {
  const { data } = await admin
    .from('profiles')
    .select('id, full_name, admin_role, is_suspended')
    .eq('role', 'admin')
    .not('admin_role', 'is', null)
  return (data ?? [])
    .filter((p) => !p.is_suspended)
    .map((p) => ({ id: p.id as string, name: formatName(p.full_name as string | null) || 'Staff' }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------- tuition card tallies ----

/** "6 applied · 2 forwarded · 1 hired" for the admin tuition cards. */
export async function stageTallies(jobIds: string[]): Promise<Map<string, StageTally>> {
  const out = new Map<string, StageTally>()
  const admin = createAdminClient()
  if (!admin || jobIds.length === 0) return out
  try {
    const { counted } = await loadCounted(admin, jobIds)
    const byJob = new Map<string, Stage[]>()
    for (const a of counted) byJob.set(a.job_id, [...(byJob.get(a.job_id) ?? []), a.stage])
    for (const [id, stages] of byJob) out.set(id, tallyStages(stages))
  } catch {
    /* a tally is decoration — never break the list */
  }
  return out
}

// ------------------------------------------------------------------ writes ----

export type WriteResult = { ok: true; changed: number } | { ok: false; status: 400 | 403 | 404 | 503; error: string }

const NOT_WORKING = 'This is not working right now. Please try again in a few minutes.'

async function actorName(admin: Admin, actor: AdminActor): Promise<string | null> {
  const { data } = await admin.from('profiles').select('full_name').eq('id', actor.id).maybeSingle()
  return formatName(data?.full_name as string | null) || null
}

/** Write one stage change: the row, its history, the tuition's audit trail and
 *  the tutor's timeline. The caller has already decided it is allowed. */
export async function writeStage(admin: Admin, actor: AdminActor, name: string | null, app: Pick<AppRow, 'id' | 'job_id' | 'tutor_id' | 'stage'>, to: Stage, reason: string, at?: string): Promise<boolean> {
  if (app.stage === to) return false
  // `at`: the Applied message (v3.1) stamps the stage, the forward and the
  // follow-up with ONE time, so its Undo can tell nothing changed since.
  const now = at ?? new Date().toISOString()
  const { error } = await admin
    .from('applications')
    .update({
      stage: to,
      stage_changed_at: now,
      stage_changed_by: actor.id,
      stage_changed_by_name: name,
      worked_at: now,
      worked_by: actor.id,
      worked_by_name: name,
    })
    .eq('id', app.id)
    .eq('stage', app.stage)
  if (error) throw new Error(error.message)
  await admin.from('application_stage_events').insert({
    application_id: app.id,
    job_id: app.job_id,
    tutor_id: app.tutor_id,
    from_stage: app.stage,
    to_stage: to,
    staff_id: actor.id,
    staff_name: name,
  })
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'application.stage',
    targetType: 'job',
    targetId: app.job_id,
    detail: { applicationId: app.id, tutorId: app.tutor_id, from: app.stage, to, reason },
  })
  await logActivity({
    userId: app.tutor_id,
    event: 'application_stage_changed',
    targetType: 'application',
    targetId: app.id,
    meta: { jobId: app.job_id, from: app.stage, to, stage: STAGE_LABEL[to] },
  })
  return true
}

/**
 * Change one application's stage. The Owner changes any; anyone else only on
 * a tuition they own. On Hired, `alsoNotSelected` names the tuition's OTHER
 * open applications to close as Not selected (default: none). Never touches
 * the tuition itself.
 */
export async function changeStage(args: { actor: AdminActor; applicationId: string; stage: Stage; alsoNotSelected?: string[] }): Promise<WriteResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_WORKING }
  const { data: app } = await admin.from('applications').select(APP_COLS).eq('id', args.applicationId).maybeSingle()
  if (!app) return { ok: false, status: 404, error: 'That application was not found. Reload the page.' }
  const row = app as AppRow
  if (row.withdrawn_at) return { ok: false, status: 400, error: 'The tutor withdrew this application.' }
  const owners = await loadOwners(admin, [row.job_id])
  const ownerId = owners.get(row.job_id) ?? null
  if (!mayEditStage(args.actor, ownerId)) {
    return { ok: false, status: 403, error: "You can change stages only on your own tuitions' applications." }
  }
  const name = await actorName(admin, args.actor)
  let changed = 0
  try {
    if (await writeStage(admin, args.actor, name, row, args.stage, 'stage')) changed++
    if (args.stage === 'hired' && args.alsoNotSelected?.length) {
      const { data: siblings } = await admin.from('applications').select(APP_COLS).eq('job_id', row.job_id)
      const open = otherOpenOnJob(
        ((siblings ?? []) as AppRow[]).filter((s) => !s.withdrawn_at).map((s) => ({ ...s, jobId: s.job_id })),
        { id: row.id, jobId: row.job_id },
      )
      const wanted = new Set(args.alsoNotSelected)
      for (const s of open) {
        if (!wanted.has(s.id)) continue
        if (await writeStage(admin, args.actor, name, s, 'not_selected', 'another tutor hired')) changed++
      }
    }
  } catch {
    return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  }
  return { ok: true, changed }
}

export type OtherOpen = { id: string; tutorName: string; stage: Stage }

/** For the Hired confirmation: the tuition's other applications still moving. */
export async function otherOpenApplications(applicationId: string): Promise<OtherOpen[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data: app } = await admin.from('applications').select('id, job_id').eq('id', applicationId).maybeSingle()
  if (!app) return []
  const { counted } = await loadCounted(admin, [app.job_id as string])
  const open = otherOpenOnJob(counted.map((c) => ({ ...c, jobId: c.job_id })), { id: app.id as string, jobId: app.job_id as string })
  const people = await pageAllIn<{ id: string; full_name: string | null }, string>([...new Set(open.map((o) => o.tutor_id))], (ids, from, to) =>
    admin.from('profiles').select('id, full_name').in('id', ids).order('id').range(from, to),
  )
  const nameBy = new Map(people.map((p) => [p.id, formatName(p.full_name) || 'Tutor']))
  return open.map((o) => ({ id: o.id, tutorName: nameBy.get(o.tutor_id) ?? 'Tutor', stage: o.stage }))
}

/**
 * A forward to the parent moves each included tutor's application from
 * Applied to Forwarded (lib/applicantForwards recordForward). Later stages are
 * left alone.
 */
export async function advanceForwarded(actor: AdminActor, jobId: string, tutorIds: string[]): Promise<number> {
  const admin = createAdminClient()
  if (!admin || tutorIds.length === 0) return 0
  const { data } = await admin.from('applications').select(APP_COLS).eq('job_id', jobId).in('tutor_id', tutorIds)
  const name = await actorName(admin, actor)
  let n = 0
  const touched: string[] = []
  for (const a of (data ?? []) as AppRow[]) {
    if (a.withdrawn_at) continue
    if (a.stage !== 'applied') {
      touched.push(a.id)
      continue
    }
    try {
      if (await writeStage(admin, actor, name, a, 'forwarded', 'forwarded to parent')) n++
    } catch {
      /* the forward itself is recorded; a stage that did not move shows Applied */
    }
  }
  // Forwarding is activity on every included application (Applications v2):
  // one already past Applied keeps its stage and sinks as worked.
  await markWorked(admin, actor, name, touched)
  return n
}

/**
 * Record activity on applications without changing their stage — a WhatsApp
 * check-in tap, or forwarding one already past Applied (owner, 22 Oct 2026).
 * The row sinks to the bottom of its tuition group until it is overdue again.
 */
async function markWorked(admin: Admin, actor: AdminActor, name: string | null, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const now = new Date().toISOString()
  await admin.from('applications').update({ worked_at: now, worked_by: actor.id, worked_by_name: name }).in('id', ids)
}

/** The WhatsApp check-in tap (/api/admin/applications/whatsapp). Tolerant. */
export async function recordCheckInTap(actor: AdminActor, applicationId: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return
  try {
    await markWorked(admin, actor, await actorName(admin, actor), [applicationId])
  } catch {
    /* the tap still opens WhatsApp; it just does not sink */
  }
}

/** Who changed it, when the parent did it through the site's own hire flow. */
export const PARENT_NAME = 'Parent'

/**
 * A parent's hire through the site's own flow (lib/jobs hireApplicant) moves
 * that tutor's application on that tuition to Hired, recorded as changed by
 * "Parent": the stage history, the tuition's history (admin_audit_log) and the
 * tutor's timeline. The other applicants are NOT marked, and the tuition itself
 * is not touched here. Returns true when the stage moved. Tolerant: a failure
 * never undoes the hire.
 */
export async function recordParentHire(args: { jobId: string; tutorId: string; parentId: string; at?: string; reason?: string }): Promise<boolean> {
  const admin = createAdminClient()
  if (!admin) return false
  try {
    const { data } = await admin.from('applications').select(APP_COLS).eq('job_id', args.jobId).eq('tutor_id', args.tutorId).maybeSingle()
    const app = data as AppRow | null
    if (!app || app.withdrawn_at || app.stage === 'hired') return false
    const now = args.at ?? new Date().toISOString()
    const { error } = await admin
      .from('applications')
      .update({
        stage: 'hired',
        stage_changed_at: now,
        stage_changed_by: args.parentId,
        stage_changed_by_name: PARENT_NAME,
        worked_at: now,
        worked_by: args.parentId,
        worked_by_name: PARENT_NAME,
      })
      .eq('id', app.id)
      .eq('stage', app.stage)
    if (error) return false
    await admin.from('application_stage_events').insert({
      application_id: app.id,
      job_id: app.job_id,
      tutor_id: app.tutor_id,
      from_stage: app.stage,
      to_stage: 'hired',
      staff_id: null,
      staff_name: PARENT_NAME,
      created_at: now,
    })
    await admin.from('admin_audit_log').insert({
      actor_id: args.parentId,
      actor_role: 'member',
      actor_email: null,
      action: 'application.stage',
      target_type: 'job',
      target_id: app.job_id,
      detail: { applicationId: app.id, tutorId: app.tutor_id, from: app.stage, to: 'hired', reason: args.reason ?? 'parent hired', by: 'parent' },
    })
    await logActivity({
      userId: app.tutor_id,
      event: 'application_stage_changed',
      targetType: 'application',
      targetId: app.id,
      meta: { jobId: app.job_id, from: app.stage, to: 'hired', stage: STAGE_LABEL.hired, by: 'parent' },
    })
    return true
  } catch {
    return false
  }
}

/**
 * Reassign the owner of one or more tuitions. Only the site Owner. `staffId`
 * null = Unassigned. Every change is in admin_audit_log (job.owner_assign).
 * The row is updated, never deleted.
 */
export async function reassignOwner(args: { actor: AdminActor; jobIds: string[]; staffId: string | null }): Promise<WriteResult> {
  if (!mayReassign(args.actor)) return { ok: false, status: 403, error: 'Only the Owner can reassign tuitions.' }
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_WORKING }
  const jobIds = [...new Set(args.jobIds)].slice(0, 500)
  if (jobIds.length === 0) return { ok: false, status: 400, error: 'Choose at least one tuition.' }
  if (args.staffId) {
    const staff = await loadStaffOptions(admin)
    if (!staff.some((s) => s.id === args.staffId)) return { ok: false, status: 400, error: 'Choose a staff member from the list.' }
  }
  const { data: jobs } = await admin.from('jobs').select('id').in('id', jobIds)
  const real = new Set((jobs ?? []).map((j) => j.id as string))
  const owners = await loadOwners(admin, jobIds)
  const name = await actorName(admin, args.actor)
  let changed = 0
  for (const id of jobIds) {
    if (!real.has(id)) continue
    const from = owners.get(id) ?? null
    if (from === args.staffId) continue
    const { error } = await admin.from('tuition_owners').upsert(
      { job_id: id, staff_id: args.staffId, source: 'reassigned', assigned_by: args.actor.id, assigned_by_name: name, assigned_at: new Date().toISOString() },
      { onConflict: 'job_id' },
    )
    if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
    await logAdminAction({
      actorId: args.actor.id,
      actorRole: args.actor.adminRole,
      actorEmail: args.actor.email,
      action: 'job.owner_assign',
      targetType: 'job',
      targetId: id,
      detail: { from, to: args.staffId },
    })
    changed++
  }
  return { ok: true, changed }
}

/** A newly posted staff tuition belongs to the staff member who posted it. */
export async function recordPoster(admin: Admin, jobId: string, staffId: string): Promise<void> {
  await admin.from('tuition_owners').upsert({ job_id: jobId, staff_id: staffId, posted_by: staffId, source: 'poster' }, { onConflict: 'job_id', ignoreDuplicates: true })
}

// -------------------------------------------------------- tutor dashboard ----

export type TutorApplicationCard = {
  id: string
  title: string
  city: string | null
  appliedAt: string
  stage: Stage
  path: string | null
}

/** The tutor's own applications (not withdrawn), newest first. */
export async function tutorApplicationCards(tutorId: string): Promise<TutorApplicationCard[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data: apps } = await admin
    .from('applications')
    .select('id, job_id, stage, created_at, withdrawn_at')
    .eq('tutor_id', tutorId)
    .is('withdrawn_at', null)
    .order('created_at', { ascending: false })
  const list = (apps ?? []).filter((a) => a.job_id)
  if (list.length === 0) return []
  const jobs = await pageAllIn<{ id: string; title: string | null; city: string | null; public_slug: string | null; job_tx_id: string | null }, string>(
    [...new Set(list.map((a) => a.job_id as string))],
    (ids, from, to) => admin.from('jobs').select('id, title, city, public_slug, job_tx_id').in('id', ids).order('id').range(from, to),
  )
  const jobBy = new Map(jobs.map((j) => [j.id, j]))
  return list.map((a) => {
    const j = jobBy.get(a.job_id as string)
    return {
      id: a.id as string,
      // The title a tutor sees is masked like every non-staff surface (PR91).
      title: maskTuitionText((j?.title ?? '').trim() || 'Tuition').text,
      city: j?.city ?? null,
      appliedAt: a.created_at as string,
      stage: ((a.stage as Stage) ?? 'applied') as Stage,
      path: j ? tuitionPath({ public_slug: j.public_slug, city: j.city, job_tx_id: j.job_tx_id, id: j.id }) : null,
    }
  })
}

export { ENDED_STAGES, isOpenStage }
