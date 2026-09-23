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
import { sanitizeOrTerm } from '@/lib/pgFilter'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { ensureProfile } from '@/lib/ensureProfile'
import { deliverEmail } from '@/lib/notify'
import type { AdminRole } from '@/lib/adminAuth'
import type { Actor } from '@/lib/moderation'

/** Roles the owner may hand out. 'owner' is absent deliberately. */
export const ASSIGNABLE_ROLES: AdminRole[] = ['admin', 'operations']

export type StaffResult =
  | {
      ok: true
      userId: string
      /** True when the invite email was actually delivered. */
      invited: boolean
      /** The temporary password, only on the (rare) no-link fallback path. */
      temporaryPassword?: string
      /** The one-time invite link, returned to the owner ONLY when the email
       *  could not be sent, so they can pass it on themselves. */
      inviteLink?: string
    }
  | {
      ok: false
      status: number
      error: string
      /** When the email already has an account, so the Team screen can route the
       *  owner to Resend invite (a staff account) or Grant role (a member)
       *  instead of a dead end (owner PR12 §1.2). */
      existing?: { userId: string; role: string; isStaff: boolean }
    }

// Where an accepted invite lands: the set-password screen, then straight into
// the admin panel. Threaded through /api/auth/callback's same-origin `next`.
const INVITE_NEXT = '/account/password?next=/admin'

/** A password nobody has to invent, and nobody keeps. */
function temporaryPassword(): string {
  // 24 hex characters plus a fixed shape that satisfies any policy requiring
  // mixed classes. It is replaced on first sign-in.
  return `Tm-${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 20)}!`
}

/**
 * The link an invited staff member clicks: our own callback with the hashed
 * token, which it verifies with verifyOtp (no PKCE code_verifier needed for an
 * admin-issued link) and then redirects to the set-password screen. Building our
 * own URL — rather than Supabase's action_link — is what lets us send the email
 * from the house template instead of the Supabase default.
 */
function buildInviteUrl(origin: string, hashedToken: string, type: 'invite' | 'recovery'): string {
  const params = new URLSearchParams({ token_hash: hashedToken, type, next: INVITE_NEXT })
  return `${origin}/api/auth/callback?${params.toString()}`
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
    const isStaff = existing.role === 'admin'
    return {
      ok: false,
      status: 409,
      error: isStaff
        ? 'That email is already a staff account — resend their invite instead.'
        : `That email already has a ${existing.role} account — grant them a role instead.`,
      existing: { userId: existing.id as string, role: existing.role as string, isStaff },
    }
  }

  let userId: string
  let inviteUrl: string | null = null
  let password: string | undefined

  // Generate an INVITE link (this creates the user; it sends no email — we send
  // our own, in the house template). The link lands the invitee on the
  // set-password screen via /api/auth/callback. inviteUserByEmail was wrong on
  // two counts: it sent Supabase's default email, and its redirect was /login —
  // a bare form with no set-password step, which is the bug being fixed.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { data: { full_name: fullName }, redirectTo: `${params.origin}/api/auth/callback` },
  })

  const hashedToken = link?.properties?.hashed_token
  if (!linkError && link?.user && hashedToken) {
    userId = link.user.id
    inviteUrl = buildInviteUrl(params.origin, hashedToken, 'invite')
  } else {
    // Link generation unavailable: create the account directly with a temp
    // password and report it back, rather than claiming an email was sent.
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

  // Authoritative upsert, not a bare .update(): if the on_auth_user_created
  // trigger is ever missing again (it was, silently, from 5 Sep — see
  // lib/ensureProfile.ts) an .update().eq(id) hits zero rows and leaves a staff
  // account with no profile. This creates the row if the trigger did not.
  //
  // welcomed_at is stamped now so the confirm callback's once-only welcome does
  // NOT also send this admin the member 'welcome' email — they get the staff
  // invite, not "find tutors across Pakistan".
  const made = await ensureProfile(admin, {
    userId,
    role: 'admin',
    fullName,
    email,
    extra: {
      admin_role: params.adminRole,
      must_change_password: true,
      welcomed_at: new Date().toISOString(),
    },
  })

  if (!made.ok) {
    // A half-made staff account is an auth user who can sign in and is not an
    // admin — confusing, and it holds the email address hostage. Remove it.
    await admin.auth.admin.deleteUser(userId)
    return { ok: false, status: 400, error: made.error }
  }

  // Send the house invite email when we have a link. `invited` reflects whether
  // it actually went out; if it did not, the link is handed back to the owner.
  let invited = false
  if (inviteUrl) {
    const sent = await deliverEmail(
      { userId },
      { id: 'staff_invite', name: fullName, role: params.adminRole, url: inviteUrl },
    )
    invited = sent.ok
  }

  await logAdminAction({
    actorId: params.actor.id,
    actorRole: params.actor.adminRole,
    actorEmail: params.actor.email,
    action: 'staff.create',
    targetType: 'profile',
    targetId: userId,
    // Neither the password nor the invite link is written to the audit log.
    detail: { email, fullName, adminRole: params.adminRole, invited },
  })

  await logActivity({
    userId,
    event: 'staff_created',
    targetType: 'profile',
    targetId: userId,
    meta: { adminRole: params.adminRole, invited },
  })

  return {
    ok: true,
    userId,
    invited,
    temporaryPassword: password,
    inviteLink: invited ? undefined : (inviteUrl ?? undefined),
  }
}

/**
 * Reissue a staff invite. The original invite/recovery token is single-use and
 * time-limited, so an invite that expired or was half-consumed (clicked but
 * never completed) leaves the person with no way in — this mints a FRESH link
 * and re-sends the house email. Uses a 'recovery' link, since the account
 * already exists; it lands on the same set-password → admin flow.
 */
export async function resendStaffInvite(params: {
  userId: string
  actor: Actor
  origin: string
}): Promise<{ ok: true; invited: boolean; inviteLink?: string } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  const { data: target } = await admin
    .from('profiles')
    .select('id, role, email, full_name, admin_role')
    .eq('id', params.userId)
    .maybeSingle()

  if (!target || target.role !== 'admin' || !target.admin_role) {
    return { ok: false, status: 404, error: 'That is not a staff account.' }
  }
  const email = (target.email as string | null) ?? ''
  if (!email) return { ok: false, status: 400, error: 'That account has no email to send to.' }

  // Stamp welcomed_at if it is not already set, so the recovery callback's
  // once-only welcome does not mail this admin the member "welcome" email. (Old
  // invites created before this fix never stamped it.)
  await admin
    .from('profiles')
    .update({ welcomed_at: new Date().toISOString() })
    .eq('id', params.userId)
    .is('welcomed_at', null)

  const { data: link, error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${params.origin}/api/auth/callback` },
  })
  const hashedToken = link?.properties?.hashed_token
  if (error || !hashedToken) {
    return { ok: false, status: 400, error: error?.message ?? 'Could not generate a new invite link.' }
  }

  const inviteUrl = buildInviteUrl(params.origin, hashedToken, 'recovery')
  const sent = await deliverEmail(
    { userId: params.userId },
    {
      id: 'staff_invite',
      name: (target.full_name as string | null) ?? 'there',
      role: (target.admin_role as string) ?? 'staff',
      url: inviteUrl,
    },
  )

  await logAdminAction({
    actorId: params.actor.id,
    actorRole: params.actor.adminRole,
    actorEmail: params.actor.email,
    action: 'staff.invite_resend',
    targetType: 'profile',
    targetId: params.userId,
    detail: { email, delivered: sent.ok },
  })

  return { ok: true, invited: sent.ok, inviteLink: sent.ok ? undefined : inviteUrl }
}

/** A member who could be granted a staff role — for the Team search box. */
export type GrantCandidate = {
  id: string
  fullName: string | null
  email: string | null
  role: string | null
  /** A LISTED tutor (public profile renders) — granting is warned. */
  listedTutor: boolean
  /** An empty, never-completed tutor account — granting drops the tutor role. */
  emptyTutor: boolean
}

/**
 * Search existing members by name or email, to grant one a staff role. Excludes
 * accounts that are already staff (they use changeStaffRole) and, being an
 * owner-only screen, reads through the service role.
 */
export async function searchGrantCandidates(query: string): Promise<GrantCandidate[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const q = query.trim()
  if (q.length < 2) return []

  const clean = sanitizeOrTerm(q)
  if (!clean) return []
  const like = `%${clean}%`
  const { data: profs } = await admin
    .from('profiles')
    .select('id, full_name, email, role')
    .neq('role', 'admin')
    .or(`full_name.ilike.${like},email.ilike.${like}`)
    .limit(10)
  const rows = profs ?? []
  if (rows.length === 0) return []

  const ids = rows.map((p) => p.id as string)
  const [{ data: listedRows }, { data: subjectRows }, { data: tpRows }] = await Promise.all([
    admin.from('tutor_visible_profiles').select('id').in('id', ids),
    admin.from('tutor_subjects').select('tutor_id').in('tutor_id', ids),
    admin.from('tutor_profiles').select('id, city, verified_fee_paid_at').in('id', ids),
  ])
  const listed = new Set((listedRows ?? []).map((r) => r.id as string))
  const hasSubjects = new Set((subjectRows ?? []).map((r) => r.tutor_id as string))
  const tp = new Map((tpRows ?? []).map((r) => [r.id as string, r]))

  return rows.map((p) => {
    const id = p.id as string
    const isTutor = p.role === 'tutor'
    const row = tp.get(id)
    // Empty = a tutor who never engaged: not listed, no fee, no subjects, no city.
    const emptyTutor =
      isTutor &&
      !listed.has(id) &&
      !hasSubjects.has(id) &&
      !(row?.city as string | null) &&
      !(row?.verified_fee_paid_at as string | null)
    return {
      id,
      fullName: (p.full_name as string | null) ?? null,
      email: (p.email as string | null) ?? null,
      role: (p.role as string | null) ?? null,
      listedTutor: isTutor && listed.has(id),
      emptyTutor,
    }
  })
}

export type GrantResult =
  | { ok: true; droppedTutor: boolean }
  // A listed tutor: the owner must confirm the dual-identity trade before it runs.
  | { ok: false; needsConfirm: true; warning: string }
  | { ok: false; status: number; error: string }

/**
 * Grant an EXISTING member a staff role (owner only, enforced by the caller).
 *
 * This is deliberately separate from createStaff: no new account, no invite, no
 * temporary password — the person already has a login, and afterwards it also
 * reaches the admin panel.
 *
 *  * A LISTED tutor keeps their public tutor profile AND gains staff access on
 *    one login — a real dual identity, so the owner must confirm it first
 *    (`confirmListedTutor`).
 *  * An EMPTY, never-completed tutor account has the tutor role dropped and its
 *    empty tutor_profiles row removed, so it does not linger as a half-tutor.
 */
export async function grantStaffToExisting(params: {
  userId: string
  adminRole: AdminRole
  confirmListedTutor?: boolean
  actor: Actor
}): Promise<GrantResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  if (!ASSIGNABLE_ROLES.includes(params.adminRole)) {
    return { ok: false, status: 400, error: 'Choose a role. There is only one owner.' }
  }

  const { data: target } = await admin
    .from('profiles')
    .select('id, role, admin_role, email, full_name')
    .eq('id', params.userId)
    .maybeSingle()
  if (!target) return { ok: false, status: 404, error: 'That member was not found.' }
  if (target.role === 'admin') {
    return { ok: false, status: 409, error: 'That account is already a staff account — change its role instead.' }
  }

  const isTutor = target.role === 'tutor'
  let listedTutor = false
  let emptyTutor = false
  if (isTutor) {
    const [{ data: vis }, { data: subs }, { data: tp }] = await Promise.all([
      admin.from('tutor_visible_profiles').select('id').eq('id', params.userId).maybeSingle(),
      admin.from('tutor_subjects').select('tutor_id').eq('tutor_id', params.userId).limit(1),
      admin.from('tutor_profiles').select('city, verified_fee_paid_at').eq('id', params.userId).maybeSingle(),
    ])
    listedTutor = !!vis
    emptyTutor =
      !vis && (subs ?? []).length === 0 && !(tp?.city as string | null) && !(tp?.verified_fee_paid_at as string | null)
  }

  if (listedTutor && !params.confirmListedTutor) {
    return {
      ok: false,
      needsConfirm: true,
      warning:
        `${target.full_name ?? 'This member'} is a listed tutor. Granting a staff role gives ` +
        'them the admin panel on the same login while their public tutor profile stays live — ' +
        'one person holding both a tutor identity and staff access. Confirm to grant it.',
    }
  }

  // Grant. role becomes 'admin' (the layouts and SCREEN_ACCESS gate on it) and
  // admin_role carries the level. The password is unchanged — they already have
  // one — so no invite and no forced reset.
  const { error: upErr } = await admin
    .from('profiles')
    .update({ role: 'admin', admin_role: params.adminRole })
    .eq('id', params.userId)
  if (upErr) return { ok: false, status: 400, error: upErr.message }

  // An empty tutor account should not linger as a half-tutor: drop the empty
  // tutor_profiles row. A listed/real tutor KEEPS theirs (the public profile).
  let droppedTutor = false
  if (emptyTutor) {
    await admin.from('tutor_profiles').delete().eq('id', params.userId)
    droppedTutor = true
  }

  await logAdminAction({
    actorId: params.actor.id,
    actorRole: params.actor.adminRole,
    actorEmail: params.actor.email,
    action: 'staff.grant_existing',
    targetType: 'profile',
    targetId: params.userId,
    detail: {
      email: target.email,
      fromRole: target.role,
      toAdminRole: params.adminRole,
      wasListedTutor: listedTutor,
      droppedEmptyTutor: droppedTutor,
    },
  })

  await logActivity({
    userId: params.userId,
    event: 'staff_created',
    targetType: 'profile',
    targetId: params.userId,
    meta: { adminRole: params.adminRole, grantedToExisting: true, droppedTutor },
  })

  return { ok: true, droppedTutor }
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
