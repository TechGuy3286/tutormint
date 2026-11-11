// lib/staffPause.ts
//
// "Pause" and "Resume" on the Team page (owner, 11 Nov 2026; rules in
// lib/staffPauseCore, migration 229). Owner only. Pause:
//   1. profiles.staff_paused_* set — getAdminActor and the database's staff
//      checks (is_admin(), is_admin_writer(), …) refuse the account at once;
//   2. every session and refresh token revoked (signed out of every device);
//   3. the staff link deactivated, stamped with the pause time (sign-ups
//      through it credit Admin while paused);
//   4. their cities and tuitions handed to the Owner (lib/staffHandover); what
//      moved is kept on staff_pause_handover.
// Resume undoes 1 and 3, and gives back the cities and tuitions nobody has
// touched since. History (approvals, follow-ups, credits, tuitions posted)
// is never changed. Audited staff.pause / staff.resume.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAllIn } from '@/lib/pageAll'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { markSummaryDirty } from '@/lib/summaryDirty'
import type { AdminActor } from '@/lib/adminAuth'
import { formatName } from '@/lib/formatName'
import { actorDisplayName, handOverToOwner } from '@/lib/staffHandover'
import { pauseProblem, readHandover, restorable, resumeProblem, type PauseTarget } from '@/lib/staffPauseCore'

type Result = { ok: true; name: string; sessionsRevoked: boolean; cities: number; tuitions: number } | { ok: false; status: number; error: string }

async function loadTarget(admin: NonNullable<ReturnType<typeof createAdminClient>>, userId: string) {
  const { data } = await admin
    .from('profiles')
    .select('id, full_name, role, admin_role, staff_paused_at, staff_pause_handover, former_staff_at')
    .eq('id', userId)
    .maybeSingle()
  if (!data) return null
  const t: PauseTarget = {
    id: data.id as string,
    role: (data.role as string | null) ?? null,
    adminRole: (data.admin_role as string | null) ?? null,
    pausedAt: (data.staff_paused_at as string | null) ?? null,
    formerAt: (data.former_staff_at as string | null) ?? null,
  }
  return { t, name: formatName((data.full_name as string | null) ?? '') || 'Staff member', handover: data.staff_pause_handover }
}

export async function pauseStaff(actor: AdminActor, userId: string, reason: string): Promise<Result> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now.' }
  const found = await loadTarget(admin, userId)
  const problem = pauseProblem(actor, found?.t ?? null)
  if (problem) return { ok: false, status: problem === 'That is not a staff account.' ? 404 : 403, error: problem }
  const now = new Date().toISOString()
  const clean = reason.trim().slice(0, 500) || null

  const { data: updated, error } = await admin
    .from('profiles')
    .update({ staff_paused_at: now, staff_paused_by: actor.id, staff_paused_reason: clean })
    .eq('id', userId)
    .is('staff_paused_at', null)
    .select('id')
  if (error || !updated?.length) return { ok: false, status: 400, error: 'That did not save. Please try again.' }

  const { error: revErr } = await admin.rpc('revoke_user_sessions', { uid: userId })
  await admin.from('staff_join_links').update({ deactivated_at: now }).eq('staff_id', userId).is('deactivated_at', null)
  const handover = await handOverToOwner(admin, actor, userId, now, 'staff paused')
  if (handover) await admin.from('profiles').update({ staff_pause_handover: handover }).eq('id', userId)

  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'staff.pause',
    targetType: 'profile',
    targetId: userId,
    detail: { adminRole: found!.t.adminRole, reason: clean, sessionsRevoked: !revErr, cities: handover?.cities.length ?? 0, tuitions: handover?.jobs.length ?? 0 },
  })
  await logActivity({ userId, event: 'staff_role_changed', targetType: 'profile', targetId: userId, meta: { paused: true } })
  await markSummaryDirty()
  return { ok: true, name: found!.name, sessionsRevoked: !revErr, cities: handover?.cities.length ?? 0, tuitions: handover?.jobs.length ?? 0 }
}

export async function resumeStaff(actor: AdminActor, userId: string): Promise<Result> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now.' }
  const found = await loadTarget(admin, userId)
  const problem = resumeProblem(actor, found?.t ?? null)
  if (problem) return { ok: false, status: problem === 'That is not a staff account.' ? 404 : 403, error: problem }
  const pausedAt = found!.t.pausedAt!
  const h = readHandover(found!.handover)

  const { error } = await admin
    .from('profiles')
    .update({ staff_paused_at: null, staff_paused_by: null, staff_paused_reason: null, staff_pause_handover: null })
    .eq('id', userId)
  if (error) return { ok: false, status: 400, error: 'That did not save. Please try again.' }

  // The link the pause switched off works again (a link switched off for any
  // other reason stays off).
  await admin.from('staff_join_links').update({ deactivated_at: null }).eq('staff_id', userId).eq('deactivated_at', pausedAt)

  let cities = 0
  let tuitions = 0
  if (h) {
    const actorName = await actorDisplayName(admin, actor.id)
    const { data: cityRows } = h.cities.length ? await admin.from('city_owners').select('city, staff_id, updated_at').in('city', h.cities) : { data: [] }
    const jobRows = await pageAllIn(h.jobs.map((j) => j.jobId), (part, f, t) =>
      admin.from('tuition_owners').select('job_id, staff_id, assigned_at').in('job_id', part).order('job_id').range(f, t),
    )
    const back = restorable(h, {
      cities: (cityRows ?? []).map((c) => ({ city: c.city as string, staffId: (c.staff_id as string | null) ?? null, updatedAt: (c.updated_at as string | null) ?? null })),
      jobs: jobRows.map((j) => ({ jobId: j.job_id as string, staffId: (j.staff_id as string | null) ?? null, assignedAt: (j.assigned_at as string | null) ?? null })),
    })
    const now = new Date().toISOString()
    if (back.cities.length) {
      const { data: done } = await admin
        .from('city_owners')
        .update({ staff_id: userId, updated_by: actor.id, updated_by_name: actorName, updated_at: now })
        .in('city', back.cities)
        .is('staff_id', null)
        .select('city')
      cities = done?.length ?? 0
    }
    for (const j of back.jobs) {
      const { data: done } = await admin
        .from('tuition_owners')
        .update({ staff_id: userId, source: j.source ?? 'reassigned', assigned_by: actor.id, assigned_by_name: actorName, assigned_at: now })
        .eq('job_id', j.jobId)
        .eq('staff_id', h.ownerId)
        .select('job_id')
      if (done?.length) tuitions += 1
    }
  }

  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'staff.resume',
    targetType: 'profile',
    targetId: userId,
    detail: { adminRole: found!.t.adminRole, citiesBack: cities, tuitionsBack: tuitions },
  })
  await logActivity({ userId, event: 'staff_role_changed', targetType: 'profile', targetId: userId, meta: { resumed: true } })
  await markSummaryDirty()
  return { ok: true, name: found!.name, sessionsRevoked: false, cities, tuitions }
}
