// lib/formerStaff.ts
//
// The server half of the staff clean-up (owner, 24 Oct 2026; rules in
// lib/formerStaffCore). makeFormerStaff() and restoreStaffAccess() are the
// only writers of profiles.former_staff_*. Every change writes admin_audit_log;
// nothing is deleted. Never logs a phone, CNIC or email.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll, pageAllIn } from '@/lib/pageAll'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import type { AdminActor } from '@/lib/adminAuth'
import { formatName } from '@/lib/formatName'
import { cityKey, cityOwnerFor } from '@/lib/cityOwnersCore'
import { canRestore, restoreRoleFor, UNTOUCHABLE_ROLES, type StaffAccount } from '@/lib/formerStaffCore'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

/** Every account with staff access or staff ties (an ACTIVE staff link, a city
 *  it owns, or a place on the target list), for the clean-up plan. */
export async function loadStaffAccounts(): Promise<StaffAccount[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const [{ data: staff }, links, { data: cities }, { data: list }] = await Promise.all([
    admin.from('profiles').select('id').or('role.eq.admin,admin_role.not.is.null'),
    pageAll<{ staff_id: string; deactivated_at: string | null }>((f, t) => admin.from('staff_join_links').select('staff_id, deactivated_at').order('staff_id').range(f, t)),
    admin.from('city_owners').select('staff_id').not('staff_id', 'is', null),
    admin.from('staff_target_list').select('staff_id, on_list').eq('on_list', true),
  ])
  const ties = new Set<string>([
    ...links.filter((l) => !l.deactivated_at).map((l) => l.staff_id),
    ...(cities ?? []).map((c) => c.staff_id as string),
    ...(list ?? []).map((l) => l.staff_id as string),
  ])
  const ids = [...new Set([...(staff ?? []).map((s) => s.id as string), ...ties])]
  const rows = await pageAllIn(ids, (part, f, t) =>
    admin.from('profiles').select('id, full_name, role, admin_role, former_staff_at').in('id', part).order('id').range(f, t),
  )
  return rows.map((r) => ({
    id: r.id as string,
    name: formatName((r.full_name as string | null) ?? '') || '—',
    role: (r.role as string | null) ?? null,
    adminRole: (r.admin_role as string | null) ?? null,
    hasStaffTies: ties.has(r.id as string),
    formerAt: (r.former_staff_at as string | null) ?? null,
  }))
}

async function siteOwnerId(admin: Admin): Promise<string | null> {
  const { data } = await admin.from('profiles').select('id').eq('role', 'admin').eq('admin_role', 'owner').limit(1).maybeSingle()
  return (data?.id as string | undefined) ?? null
}

/** The role a removed staff member last held (the latest staff.remove /
 *  role-change audit row), for an account that is already an ordinary member. */
async function lastStaffRole(admin: Admin, userId: string): Promise<string | null> {
  const { data } = await admin
    .from('admin_audit_log')
    .select('action, detail, created_at')
    .eq('target_id', userId)
    .in('action', ['staff.remove', 'staff.role_change', 'staff.create', 'staff.grant_existing'])
    .order('created_at', { ascending: false })
    .limit(10)
  for (const r of data ?? []) {
    const d = (r.detail ?? {}) as Record<string, unknown>
    const role = (r.action === 'staff.role_change' ? d.to : d.adminRole) as string | undefined
    if (role) return role
  }
  return null
}

export type MovedTuition = { jobId: string; ref: string | null; city: string | null; toId: string }

export type FormerStaffResult =
  | { ok: true; name: string; fromRole: string | null; citiesReleased: string[]; moved: MovedTuition[]; sessionsRevoked: boolean }
  | { ok: false; status: number; error: string }

/**
 * Make one account former staff. Refuses the Owner and the Project Managers
 * (owner-level access is never changed here) and the actor's own account.
 */
export async function makeFormerStaff(actor: AdminActor, userId: string, reason: string): Promise<FormerStaffResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now.' }
  if (userId === actor.id) return { ok: false, status: 400, error: 'You cannot remove your own staff access.' }
  const { data: p } = await admin.from('profiles').select('id, full_name, role, admin_role, former_staff_at').eq('id', userId).maybeSingle()
  if (!p) return { ok: false, status: 404, error: 'That account was not found.' }
  if (UNTOUCHABLE_ROLES.has((p.admin_role as string | null) ?? '')) return { ok: false, status: 403, error: 'Owner-level access is never changed here.' }
  const name = formatName((p.full_name as string | null) ?? '') || 'Staff member'
  const fromRole = ((p.admin_role as string | null) ?? null) || (await lastStaffRole(admin, userId))
  const now = new Date().toISOString()

  // 1. Admin access off; the account stays as an ordinary member.
  const patch: Record<string, unknown> = { former_staff_at: (p.former_staff_at as string | null) ?? now, former_staff_role: fromRole, former_staff_by: actor.id }
  if (p.role === 'admin') Object.assign(patch, { role: 'parent', admin_role: null, is_suspended: false, suspension_reason: null, suspended_at: null, suspended_by: null })
  const { error: upErr } = await admin.from('profiles').update(patch).eq('id', userId)
  if (upErr) return { ok: false, status: 400, error: 'That did not save. Please try again.' }

  // 2. Signed out of every session (admin sessions included).
  const { error: revErr } = await admin.rpc('revoke_user_sessions', { uid: userId })

  // 3. Staff link deactivated (it still opens the site; credit goes to Admin).
  await admin.from('staff_join_links').update({ deactivated_at: now }).eq('staff_id', userId).is('deactivated_at', null)

  // 4. Off the target list; out of City owners.
  await admin.from('staff_target_list').update({ on_list: false }).eq('staff_id', userId)
  const { data: owned } = await admin.from('city_owners').select('city').eq('staff_id', userId)
  const citiesReleased = (owned ?? []).map((c) => c.city as string)
  const { data: me } = await admin.from('profiles').select('full_name').eq('id', actor.id).maybeSingle()
  const actorName = formatName((me?.full_name as string | null) ?? '') || 'Owner'
  if (citiesReleased.length) {
    await admin.from('city_owners').update({ staff_id: null, updated_by: actor.id, updated_by_name: actorName, updated_at: now }).eq('staff_id', userId)
    for (const city of citiesReleased) {
      await logAdminAction({ actorId: actor.id, actorRole: actor.adminRole, actorEmail: actor.email, action: 'city_owner.set', targetType: 'city', targetId: city, detail: { from: userId, to: null, reason: 'former staff' } })
    }
  }

  // 5. Their tuitions move to each tuition's city owner, else the site Owner.
  const moved: MovedTuition[] = []
  const ownerId = await siteOwnerId(admin)
  const rows = await pageAll<{ job_id: string }>((f, t) => admin.from('tuition_owners').select('job_id').eq('staff_id', userId).order('job_id').range(f, t))
  if (rows.length && ownerId) {
    const { data: cityRows } = await admin.from('city_owners').select('city, staff_id')
    const map = new Map<string, string>()
    for (const r of cityRows ?? []) if (r.staff_id) map.set(cityKey(r.city as string), r.staff_id as string)
    const jobs = await pageAllIn(rows.map((r) => r.job_id), (part, f, t) => admin.from('jobs').select('id, ref_id, city').in('id', part).order('id').range(f, t))
    for (const j of jobs) {
      const to = cityOwnerFor(j.city as string | null, map, ownerId)
      const { error } = await admin
        .from('tuition_owners')
        .update({ staff_id: to, source: 'city', assigned_by: actor.id, assigned_by_name: actorName, assigned_at: now })
        .eq('job_id', j.id as string)
        .eq('staff_id', userId)
      if (error) continue
      moved.push({ jobId: j.id as string, ref: (j.ref_id as string | null) ?? null, city: (j.city as string | null) ?? null, toId: to })
    }
    if (moved.length) {
      await admin.from('admin_audit_log').insert(
        moved.map((m) => ({
          actor_id: actor.id,
          actor_role: actor.adminRole,
          actor_email: actor.email,
          action: 'job.owner_assign',
          target_type: 'job',
          target_id: m.jobId,
          detail: { from: userId, to: m.toId, city: m.city, reason: 'former staff' },
        })),
      )
    }
  }

  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'staff.former',
    targetType: 'profile',
    targetId: userId,
    detail: { fromRole, reason, citiesReleased, tuitionsMoved: moved.length, sessionsRevoked: !revErr },
  })
  await logActivity({ userId, event: 'staff_removed', targetType: 'profile', targetId: userId, meta: { reason, former: true } })
  return { ok: true, name, fromRole, citiesReleased, moved, sessionsRevoked: !revErr }
}

export type RestoreResult = { ok: true; role: string } | { ok: false; status: number; error: string }

/**
 * The Owner's "Restore staff access": the role they held comes back and their
 * staff link works again. Cities and tuitions are not handed back — the Owner
 * sets those in City owners / Applications.
 */
export async function restoreStaffAccess(actor: AdminActor, userId: string): Promise<RestoreResult> {
  if (actor.adminRole !== 'owner') return { ok: false, status: 403, error: 'Only the Owner can restore staff access.' }
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now.' }
  const { data: p } = await admin.from('profiles').select('id, role, admin_role, former_staff_at, former_staff_role').eq('id', userId).maybeSingle()
  if (!p || !canRestore(p as never)) return { ok: false, status: 400, error: 'That account is not former staff.' }
  const { count } = await admin.from('tutor_profiles').select('id', { count: 'exact', head: true }).eq('id', userId)
  if ((count ?? 0) > 0) return { ok: false, status: 400, error: 'This account is a tutor account. Staff access goes on a separate account.' }
  const role = restoreRoleFor(p.former_staff_role as string | null)
  const { data: updated, error } = await admin
    .from('profiles')
    .update({ role: 'admin', admin_role: role, former_staff_at: null, former_staff_by: null })
    .eq('id', userId)
    .select('id')
  if (error || !updated?.length) return { ok: false, status: 400, error: 'That did not save. Please try again.' }
  await admin.from('staff_join_links').update({ deactivated_at: null }).eq('staff_id', userId)
  await logAdminAction({ actorId: actor.id, actorRole: actor.adminRole, actorEmail: actor.email, action: 'staff.restore', targetType: 'profile', targetId: userId, detail: { role } })
  await logActivity({ userId, event: 'staff_role_changed', targetType: 'profile', targetId: userId, meta: { restored: true, to: role } })
  return { ok: true, role }
}
