// lib/staff.ts
//
// Creating and managing admin staff. Owner only, enforced by the caller.
//
// Staff accounts are ordinary Supabase auth users whose profiles row carries
// role='admin' and an admin_role. Neither field is settable from signup
// metadata -- 14_handle_new_user.sql refuses to mint an admin -- so the only
// way to create one is here, with the service key, from a screen the owner
// alone can reach.
//
// INVITE vs TEMPORARY PASSWORD. inviteUserByEmail() is the right flow and is
// tried first, but it silently depends on SMTP being configured on the
// Supabase project. When it fails we fall back to creating the user with a
// generated password and hand that password back to the owner ONCE, to pass on
// however they like. Pretending an email went out when the project has no SMTP
// is how a new colleague sits waiting for a message that will never arrive.
//
// Either way must_change_password is set, so the temporary credential is good
// for exactly one sign-in.

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import type { AdminRole } from '@/lib/adminAuth'
import type { Actor } from '@/lib/moderation'

/** Roles the owner may hand out. 'owner' is absent deliberately. */
export const ASSIGNABLE_ROLES: AdminRole[] = ['manager', 'verifier', 'finance', 'support']

export type StaffResult =
  | { ok: true; userId: string; invited: boolean; temporaryPassword?: string }
  | { ok: false; status: number; error: string }

/** A password nobody has to invent, and nobody keeps. */
function temporaryPassword(): string {
  // 24 hex characters plus a fixed shape that satisfies any policy requiring
  // mixed classes. It is replaced on first sign-in.
  return `Tm-${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 20)}!`
}

export async function createStaff(params: {
  email: string
  fullName: string
  adminRole: AdminRole
  actor: Actor
  /** Where the invite link should land. */
  origin: string
}): Promise<StaffResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  const email = params.email.trim().toLowerCase()
  const fullName = params.fullName.trim()

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, status: 400, error: 'That does not look like an email address.' }
  }
  if (fullName.length < 2) {
    return { ok: false, status: 400, error: "Enter the person's name." }
  }
  if (!ASSIGNABLE_ROLES.includes(params.adminRole)) {
    return { ok: false, status: 400, error: 'Choose a role. There is only one owner.' }
  }

  // An existing member being promoted to staff is a different decision from
  // hiring someone, and it would silently change what an existing tutor or
  // parent account can see. Refuse and let the owner make it explicit.
  const { data: existing } = await admin
    .from('profiles')
    .select('id, role')
    .eq('email', email)
    .maybeSingle()
  if (existing) {
    return {
      ok: false,
      status: 409,
      error: `That email already has a ${existing.role} account on TutorMint.`,
    }
  }

  let userId: string | null = null
  let invited = false
  let password: string | undefined

  const { data: invite, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo: `${params.origin}/login`,
  })

  if (!inviteError && invite?.user) {
    userId = invite.user.id
    invited = true
  } else {
    // No SMTP (or the invite was refused): create the account directly and
    // report the password back instead of claiming an email was sent.
    password = temporaryPassword()
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })
    if (error || !created?.user) {
      return { ok: false, status: 400, error: error?.message ?? 'Could not create the account.' }
    }
    userId = created.user.id
  }

  const { error: profileError } = await admin
    .from('profiles')
    .update({
      role: 'admin',
      admin_role: params.adminRole,
      full_name: fullName,
      email,
      must_change_password: true,
    })
    .eq('id', userId)

  if (profileError) {
    // A half-made staff account is an auth user who can sign in and is not an
    // admin — confusing, and it holds the email address hostage. Remove it.
    await admin.auth.admin.deleteUser(userId)
    return { ok: false, status: 400, error: profileError.message }
  }

  await logAdminAction({
    actorId: params.actor.id,
    actorRole: params.actor.adminRole,
    actorEmail: params.actor.email,
    action: 'staff.create',
    targetType: 'profile',
    targetId: userId,
    // The password is never written to the audit log.
    detail: { email, fullName, adminRole: params.adminRole, invited },
  })

  await logActivity({
    userId,
    event: 'staff_created',
    targetType: 'profile',
    targetId: userId,
    meta: { adminRole: params.adminRole, invited },
  })

  return { ok: true, userId, invited, temporaryPassword: password }
}

export async function changeStaffRole(params: {
  userId: string
  adminRole: AdminRole
  actor: Actor
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  if (!ASSIGNABLE_ROLES.includes(params.adminRole)) {
    return { ok: false, status: 400, error: 'Unknown role.' }
  }
  // Both directions of the same rule: the owner cannot demote themselves, and
  // nobody can be promoted into a second owner. There is exactly one, and
  // transferring it is deliberately not a button.
  if (params.userId === params.actor.id) {
    return { ok: false, status: 400, error: 'You cannot change your own role.' }
  }

  const { data: target } = await admin
    .from('profiles')
    .select('id, role, admin_role, email')
    .eq('id', params.userId)
    .maybeSingle()

  if (!target || target.role !== 'admin') {
    return { ok: false, status: 404, error: 'That is not a staff account.' }
  }
  if (target.admin_role === 'owner') {
    return { ok: false, status: 403, error: 'The owner role cannot be changed here.' }
  }

  const { error } = await admin
    .from('profiles')
    .update({ admin_role: params.adminRole })
    .eq('id', params.userId)
  if (error) return { ok: false, status: 400, error: error.message }

  await logAdminAction({
    actorId: params.actor.id,
    actorRole: params.actor.adminRole,
    actorEmail: params.actor.email,
    action: 'staff.role_change',
    targetType: 'profile',
    targetId: params.userId,
    detail: { from: target.admin_role, to: params.adminRole, email: target.email },
  })

  await logActivity({
    userId: params.userId,
    event: 'staff_role_changed',
    targetType: 'profile',
    targetId: params.userId,
    meta: { from: target.admin_role, to: params.adminRole },
  })

  return { ok: true }
}
