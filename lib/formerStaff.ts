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
import { handOverToOwner } from '@/lib/staffHandover'
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
 * `opts.at` dates the leaving (a backfill of an earlier "Remove from team");
 * it defaults to now. "Remove from team" on the Team screen calls this too
 * (owner, 4 Nov 2026), so every removal is a former-staff record.
 */
export async function makeFormerStaff(actor: AdminActor, userId: string, reason: string, opts: { at?: string } = {}): Promise<FormerStaffResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now.' }
  if (userId === actor.id) return { ok: false, status: 400, error: 'You cannot remove your own staff access.' }
  const { data: p } = await admin.from('profiles').select('id, full_name, role, admin_role, former_staff_at').eq('id', userId).maybeSingle()
  if (!p) return { ok: false, status: 404, error: 'That account was not found.' }
  // The Owner is never changed. A Project Manager (Partner) may be removed only
  // by the Owner — the Team screen's "Remove from team" (staffChangeProblem);
  // the clean-up plan never offers either (planStaffCleanup).
  const targetRole = (p.admin_role as string | null) ?? ''
  if (targetRole === 'owner' || (UNTOUCHABLE_ROLES.has(targetRole) && actor.adminRole !== 'owner')) {
    return { ok: false, status: 403, error: 'Owner-level access is never changed here.' }
  }
  const name = formatName((p.full_name as string | null) ?? '') || 'Staff member'
  const fromRole = ((p.admin_role as string | null) ?? null) || (await lastStaffRole(admin, userId))
  const now = opts.at ?? new Date().toISOString()

  // 1. Admin access off; the account stays as an ordinary member.
  const patch: Record<string, unknown> = { former_staff_at: (p.former_staff_at as string | null) ?? now, former_staff_role: fromRole, former_staff_by: actor.id }
  if (p.role === 'admin') Object.assign(patch, { role: 'parent', admin_role: null, is_suspended: false, suspension_reason: null, suspended_at: null, suspended_by: null })
  // A paused member who is then removed is simply former staff (owner, 11 Nov 2026).
  Object.assign(patch, { staff_paused_at: null, staff_paused_by: null, staff_paused_reason: null, staff_pause_handover: null })
  const { error: upErr } = await admin.from('profiles').update(patch).eq('id', userId)
  if (upErr) return { ok: false, status: 400, error: 'That did not save. Please try again.' }

  // 2. Signed out of every session (admin sessions included).
  const { error: revErr } = await admin.rpc('revoke_user_sessions', { uid: userId })

  // 3. Staff link deactivated (it still opens the site; credit goes to Admin).
  await admin.from('staff_join_links').update({ deactivated_at: now }).eq('staff_id', userId).is('deactivated_at', null)

  // 4. Off the target list.
  await admin.from('staff_target_list').update({ on_list: false }).eq('staff_id', userId)

  // 5. Their cities and tuitions go to the Owner (owner, 11 Nov 2026 — "if
  //    staff leave, the Owner handles everything himself"), so no Applications
  //    follow-up and no Paid-tutors city is dropped.
  const handover = await handOverToOwner(admin, actor, userId, now, 'former staff')
  const citiesReleased = handover?.cities ?? []
  const moved: MovedTuition[] = (handover?.jobs ?? []).map((j) => ({ jobId: j.jobId, ref: null, city: null, toId: handover!.ownerId }))

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
