// lib/moderation.ts
//
// Warning, suspending and reinstating a member — in one place, because it is
// reachable from two screens (the reports queue and the member page) and those
// two must not drift into producing different states for the same decision.
//
// Every action here writes four things:
//   penalties_log      the sanction itself, permanent
//   admin_audit_log    who did it, with their role and email preserved
//   user_activity_log  what happened TO the member, on their own timeline
//   a notification     told to the member, in words they can act on
//
// Nothing is deleted, ever. A suspended member keeps their jobs, applications,
// chats and reviews; what stops is the transactional surface -- getEntitlements
// returns nothing for them, the dashboards redirect to /suspended, and a
// suspended tutor drops out of tutor_directory. Reinstatement is one row
// update away precisely because nothing was destroyed.

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'
import { applyPlanFlags } from '@/lib/payments/activate'
import { addToBlocklist, removeFromBlocklistBySource } from '@/lib/blocklist'
import { normalisePkMobile } from '@/lib/phone'
import type { AdminRole } from '@/lib/adminAuth'

export type Actor = { id: string; adminRole: AdminRole; email: string | null }

export type ModerationResult =
  | { ok: true; alreadyInState?: boolean }
  | { ok: false; status: number; error: string }

async function member(admin: NonNullable<ReturnType<typeof createAdminClient>>, userId: string) {
  const { data } = await admin
    .from('profiles')
    .select('id, full_name, email, role, admin_role, is_suspended')
    .eq('id', userId)
    .maybeSingle()
  return data
}

/**
 * A warning. No powers change; the member is told, and it is on the record.
 *
 * The reason is written by an admin and shown verbatim to the member, so it
 * has to be long enough to mean something -- "no" is not a warning, it is a
 * shrug that generates a support ticket.
 */
export async function warnMember(params: {
  userId: string
  reason: string
  actor: Actor
  reportId?: string | null
}): Promise<ModerationResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  const target = await member(admin, params.userId)
  if (!target) return { ok: false, status: 404, error: 'Member not found.' }

  const { error } = await admin.from('penalties_log').insert({
    user_id: params.userId,
    kind: 'warning',
    reason: params.reason,
    issued_by: params.actor.id,
    report_id: params.reportId ?? null,
  })
  if (error) return { ok: false, status: 400, error: error.message }

  await notify({
    userId: params.userId,
    kind: 'warning_issued',
    title: 'A warning has been added to your account',
    body: params.reason,
    href: '/support',
  })

  await logAdminAction({
    actorId: params.actor.id,
    actorRole: params.actor.adminRole,
    actorEmail: params.actor.email,
    action: 'member.warn',
    targetType: 'profile',
    targetId: params.userId,
    detail: { reason: params.reason, reportId: params.reportId ?? null },
  })

  await logActivity({
    userId: params.userId,
    event: 'warned',
    targetType: 'penalty',
    targetId: params.userId,
    meta: { reason: params.reason, reportId: params.reportId ?? null },
  })

  return { ok: true }
}

/**
 * Suspend a member.
 *
 * profiles.is_suspended is the single fact. For a tutor,
 * tutor_profiles.verification_status is also set to 'suspended' so the
 * moderation queue and the reports queue agree about the same person -- but
 * delisting does not depend on that second write landing: tutor_directory
 * checks profiles.is_suspended too (migration 25).
 */
export async function suspendMember(params: {
  userId: string
  reason: string
  actor: Actor
  reportId?: string | null
}): Promise<ModerationResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  const target = await member(admin, params.userId)
  if (!target) return { ok: false, status: 404, error: 'Member not found.' }

  // The owner is the account that can un-break everything else. Locking it out
  // through a queue screen would need a SQL session to undo.
  if (target.admin_role === 'owner') {
    return { ok: false, status: 403, error: 'The owner account cannot be suspended.' }
  }
  if (target.id === params.actor.id) {
    return { ok: false, status: 400, error: 'You cannot suspend your own account.' }
  }
  if (target.is_suspended) return { ok: true, alreadyInState: true }

  const now = new Date().toISOString()
  const { error } = await admin
    .from('profiles')
    .update({
      is_suspended: true,
      suspension_reason: params.reason,
      suspended_at: now,
      suspended_by: params.actor.id,
    })
    .eq('id', params.userId)
  if (error) return { ok: false, status: 400, error: error.message }

  if (target.role === 'tutor') {
    await admin
      .from('tutor_profiles')
      .update({ verification_status: 'suspended', is_featured: false })
      .eq('id', params.userId)
  }

  await admin.from('penalties_log').insert({
    user_id: params.userId,
    kind: 'suspension',
    reason: params.reason,
    issued_by: params.actor.id,
    report_id: params.reportId ?? null,
  })

  await notify({
    userId: params.userId,
    kind: 'account_suspended',
    title: 'Your account has been suspended',
    body: `${params.reason} Nothing has been deleted — contact support if you believe this is a mistake.`,
    href: '/support',
  })

  await logAdminAction({
    actorId: params.actor.id,
    actorRole: params.actor.adminRole,
    actorEmail: params.actor.email,
    action: 'member.suspend',
    targetType: 'profile',
    targetId: params.userId,
    detail: { reason: params.reason, role: target.role, reportId: params.reportId ?? null },
  })

  await logActivity({
    userId: params.userId,
    event: 'suspended',
    targetType: 'profile',
    targetId: params.userId,
    meta: { reason: params.reason, reportId: params.reportId ?? null },
  })

  return { ok: true }
}

/**
 * Reinstate. Verification goes back to 'verified' rather than 'pending': the
 * tutor had already been approved, and making them re-queue for a decision
 * that was reversed would be a second punishment.
 */
export async function unsuspendMember(params: {
  userId: string
  reason: string
  actor: Actor
}): Promise<ModerationResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  const target = await member(admin, params.userId)
  if (!target) return { ok: false, status: 404, error: 'Member not found.' }
  if (!target.is_suspended) return { ok: true, alreadyInState: true }

  const { error } = await admin
    .from('profiles')
    .update({
      is_suspended: false,
      suspension_reason: null,
      suspended_at: null,
      suspended_by: null,
    })
    .eq('id', params.userId)
  if (error) return { ok: false, status: 400, error: error.message }

  if (target.role === 'tutor') {
    await admin
      .from('tutor_profiles')
      .update({ verification_status: 'verified' })
      .eq('id', params.userId)
      .eq('verification_status', 'suspended')
  }

  // Suspension clears the Featured flag; reinstatement has to put it back for
  // anyone whose plan still entitles them to it. Without this a tutor who was
  // suspended and cleared silently lost the promotion they are still paying
  // for -- the same asymmetry the T6 renewal path had, in a different place.
  const { data: live } = await admin
    .from('subscriptions')
    .select('plan_code')
    .eq('user_id', params.userId)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle()

  if (live?.plan_code) await applyPlanFlags(params.userId, live.plan_code as string)

  await admin.from('penalties_log').insert({
    user_id: params.userId,
    kind: 'unsuspension',
    reason: params.reason,
    issued_by: params.actor.id,
  })

  await notify({
    userId: params.userId,
    kind: 'account_reinstated',
    title: 'Your account has been reinstated',
    body: 'Everything is where you left it.',
    href: target.role === 'tutor' ? '/tutor/dashboard' : '/parent/dashboard',
  })

  await logAdminAction({
    actorId: params.actor.id,
    actorRole: params.actor.adminRole,
    actorEmail: params.actor.email,
    action: 'member.unsuspend',
    targetType: 'profile',
    targetId: params.userId,
    detail: { reason: params.reason, role: target.role },
  })

  await logActivity({
    userId: params.userId,
    event: 'unsuspended',
    targetType: 'profile',
    targetId: params.userId,
    meta: { reason: params.reason },
  })

  return { ok: true }
}

/**
 * Ban a member — a PERMANENT status distinct from suspension (owner, Sunday 6
 * Sep). Where suspension is a reversible pause, a ban is for fraud: the account
 * is closed, its mobile and CNIC go on the signup/claim blocklist so the same
 * person cannot simply re-register, and the login route refuses it outright
 * with no session. Owner/manager only (enforced by the calling route).
 *
 * Nothing is deleted here either — a ban is still a row update, and unban
 * reverses it — but a banned account is closed for good in every path that
 * consults it: getEntitlements returns nothing, both listing views exclude it,
 * and login is walled.
 */
export async function banMember(params: {
  userId: string
  reason: string
  actor: Actor
}): Promise<ModerationResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  const { data: target } = await admin
    .from('profiles')
    .select('id, role, admin_role, is_banned, phone_number, cnic_number')
    .eq('id', params.userId)
    .maybeSingle()
  if (!target) return { ok: false, status: 404, error: 'Member not found.' }

  if (target.admin_role === 'owner') {
    return { ok: false, status: 403, error: 'The owner account cannot be banned.' }
  }
  if (target.id === params.actor.id) {
    return { ok: false, status: 400, error: 'You cannot ban your own account.' }
  }
  if (target.is_banned) return { ok: true, alreadyInState: true }

  const now = new Date().toISOString()
  const { error } = await admin
    .from('profiles')
    .update({
      is_banned: true,
      banned_at: now,
      banned_reason: params.reason,
      banned_by: params.actor.id,
    })
    .eq('id', params.userId)
  if (error) return { ok: false, status: 400, error: error.message }

  // The mobile and (hashed) CNIC go on the blocklist so a fresh signup or claim
  // with the same identity is refused.
  await addToBlocklist({
    mobile: normalisePkMobile(target.phone_number as string | null),
    cnic: (target.cnic_number as string | null) ?? null,
    reason: params.reason,
    sourceUserId: params.userId,
    createdBy: params.actor.id,
  })

  await admin.from('penalties_log').insert({
    user_id: params.userId,
    kind: 'ban',
    reason: params.reason,
    issued_by: params.actor.id,
  })

  await logAdminAction({
    actorId: params.actor.id,
    actorRole: params.actor.adminRole,
    actorEmail: params.actor.email,
    action: 'member.ban',
    targetType: 'profile',
    targetId: params.userId,
    detail: { reason: params.reason, role: target.role },
  })

  // On the member's own timeline (it is shown in admin). No notification: a
  // banned account has no session and cannot read one.
  await logActivity({
    userId: params.userId,
    event: 'banned',
    targetType: 'profile',
    targetId: params.userId,
    meta: { reason: params.reason },
  })

  return { ok: true }
}

/** Reverse a ban. Owner only (enforced by the route). */
export async function unbanMember(params: {
  userId: string
  reason: string
  actor: Actor
}): Promise<ModerationResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  const { data: target } = await admin
    .from('profiles')
    .select('id, role, is_banned')
    .eq('id', params.userId)
    .maybeSingle()
  if (!target) return { ok: false, status: 404, error: 'Member not found.' }
  if (!target.is_banned) return { ok: true, alreadyInState: true }

  const { error } = await admin
    .from('profiles')
    .update({ is_banned: false, banned_at: null, banned_reason: null, banned_by: null })
    .eq('id', params.userId)
  if (error) return { ok: false, status: 400, error: error.message }

  // Let the identity through signup/claim again.
  await removeFromBlocklistBySource(params.userId)

  await admin.from('penalties_log').insert({
    user_id: params.userId,
    kind: 'unban',
    reason: params.reason,
    issued_by: params.actor.id,
  })

  await notify({
    userId: params.userId,
    kind: 'account_reinstated',
    title: 'Your account has been reinstated',
    body: 'You can sign in again. Everything is where you left it.',
    href: target.role === 'tutor' ? '/tutor/dashboard' : '/parent/dashboard',
  })

  await logAdminAction({
    actorId: params.actor.id,
    actorRole: params.actor.adminRole,
    actorEmail: params.actor.email,
    action: 'member.unban',
    targetType: 'profile',
    targetId: params.userId,
    detail: { reason: params.reason, role: target.role },
  })

  await logActivity({
    userId: params.userId,
    event: 'unbanned',
    targetType: 'profile',
    targetId: params.userId,
    meta: { reason: params.reason },
  })

  return { ok: true }
}
