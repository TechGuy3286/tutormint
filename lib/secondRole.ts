import 'server-only'

// Second-role accounts, created by support (owner, 8 Oct 2026).
//
// A tutor who also wants to hire a tutor for their own child (or a parent who
// also teaches) gets a SECOND account for the other role, on the same mobile.
// The two accounts keep their own data — profile, tuitions, applications,
// messages, plans — and are linked both ways (profiles.linked_account_id).
//
//   * Created only from the admin member page, by the owner or an Admin, with a
//     reason in the Audit log. The member never self-serves it: normal sign-up
//     still refuses a mobile that is already on TutorMint.
//   * At most ONE tutor and ONE parent account per mobile — never two of the
//     same role (a unique index on (phone_number, role), migration 154, backs
//     the check below).
//   * The new account's mobile is already verified (it is the same number the
//     first account proved). Its login address is the synthetic
//     <msisdn>+<role>@users.tutormint.org; signing in goes through the first
//     account's password and a "Continue as Tutor or Parent?" picker, which
//     switches the session with a server-minted magic-link token.

import { randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { ensureProfile } from '@/lib/ensureProfile'
import { normalisePkMobile, syntheticEmail } from '@/lib/phone'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { formatName } from '@/lib/formatName'
import type { AdminActor } from '@/lib/adminAuth'

export type MemberRole = 'tutor' | 'parent'

export function otherRole(role: string | null | undefined): MemberRole | null {
  if (role === 'tutor') return 'parent'
  if (role === 'parent' || role === 'academy') return 'tutor'
  return null
}

/** The login address of a second-role account. Still synthetic (same domain). */
export function secondRoleEmail(msisdn: string, role: MemberRole): string {
  return syntheticEmail(msisdn).replace('@', `+${role}@`)
}

export type SecondRoleState =
  | { canCreate: true; role: MemberRole; name: string; mobile: string }
  | { canCreate: false; reason: string; linkedId?: string | null }

/** What the admin member page offers for this member. */
export async function secondRoleState(memberId: string): Promise<SecondRoleState> {
  const admin = createAdminClient()
  if (!admin) return { canCreate: false, reason: 'Not available right now.' }
  const { data: p } = await admin
    .from('profiles')
    .select('id, role, full_name, phone_number, phone_verified_at, linked_account_id, is_banned')
    .eq('id', memberId)
    .maybeSingle()
  if (!p) return { canCreate: false, reason: 'Member not found.' }
  const role = otherRole(p.role as string)
  if (!role) return { canCreate: false, reason: 'Only tutor and parent accounts can have a second role.' }
  if (p.linked_account_id) return { canCreate: false, reason: 'This person already has a second account.', linkedId: p.linked_account_id as string }
  if (p.is_banned) return { canCreate: false, reason: 'This account is banned.' }
  const msisdn = normalisePkMobile((p.phone_number as string | null) ?? '')
  if (!msisdn || !p.phone_verified_at) return { canCreate: false, reason: 'The member needs a verified mobile number first.' }
  const taken = await accountsOnMobile(msisdn)
  if (taken.some((a) => a.role === role)) return { canCreate: false, reason: `A ${role} account already uses this mobile.` }
  return { canCreate: true, role, name: formatName(p.full_name as string | null), mobile: msisdn }
}

/** Every tutor/parent account on a mobile (normalised), oldest first. */
export async function accountsOnMobile(msisdn: string): Promise<{ id: string; role: string; email: string; linked: string | null }[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const national = `0${msisdn.slice(2)}`
  const { data } = await admin
    .from('profiles')
    .select('id, role, email, linked_account_id, created_at')
    .or(`phone_number.eq.${msisdn},phone_number.eq.${national},phone_number.eq.+${msisdn}`)
    .in('role', ['tutor', 'parent', 'academy'])
    .order('created_at')
  return (data ?? []).map((r) => ({
    id: r.id as string,
    role: r.role === 'academy' ? 'parent' : (r.role as string),
    email: r.email as string,
    linked: (r.linked_account_id as string | null) ?? null,
  }))
}

export async function createSecondRoleAccount(
  actor: AdminActor,
  memberId: string,
  input: { name: string; reason: string },
): Promise<{ ok: true; newId: string; role: MemberRole } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Not available right now.' }
  const state = await secondRoleState(memberId)
  if (!state.canCreate) return { ok: false, status: 409, error: state.reason }
  const name = formatName(input.name.trim() || state.name)
  if (name.length < 2) return { ok: false, status: 400, error: 'Confirm the name for the new account.' }

  const email = secondRoleEmail(state.mobile, state.role)
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    // Never used to sign in directly: the picker switches into this account
    // after the member proves the first one. Random, long, never shown.
    password: randomBytes(24).toString('base64url'),
    user_metadata: { role: state.role, full_name: name },
  })
  if (error || !created?.user) {
    return { ok: false, status: 400, error: error?.message ?? 'Could not create the account.' }
  }
  const newId = created.user.id
  const now = new Date().toISOString()
  const ensured = await ensureProfile(admin, {
    userId: newId,
    role: state.role,
    fullName: name,
    email,
    phoneNumber: state.mobile,
    extra: { phone_verified_at: now, phone_verified_via: 'otp', phone_gate_required: false, linked_account_id: memberId, welcomed_at: now },
  })
  if (!ensured.ok) {
    await admin.auth.admin.deleteUser(newId).catch(() => undefined)
    return { ok: false, status: 400, error: /profiles_mobile_role_unique/.test(ensured.error) ? `A ${state.role} account already uses this mobile.` : ensured.error }
  }
  await admin.from('profiles').update({ linked_account_id: newId }).eq('id', memberId)

  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'member.second_role',
    targetType: 'member',
    targetId: memberId,
    detail: { newAccountId: newId, role: state.role, reason: input.reason.trim() },
  })
  await logActivity({ userId: memberId, event: 'second_role_created', targetType: 'profile', targetId: newId, meta: { role: state.role } })
  await logActivity({ userId: newId, event: 'second_role_created', targetType: 'profile', targetId: memberId, meta: { role: state.role, createdBy: 'support' } })
  return { ok: true, newId, role: state.role }
}

/**
 * Switch the signed-in session to the member's LINKED account of `role`. Only
 * ever from a session that already belongs to one of the two linked accounts.
 */
export async function switchToRole(role: MemberRole): Promise<{ ok: true; role: MemberRole } | { ok: false; status: number; error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401, error: 'Please sign in first, then try again.' }
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Not available right now.' }
  const { data: me } = await admin.from('profiles').select('role, linked_account_id').eq('id', user.id).maybeSingle()
  const myRole = me?.role === 'academy' ? 'parent' : (me?.role as string | null)
  if (myRole === role) return { ok: true, role }
  if (!me?.linked_account_id) return { ok: false, status: 403, error: 'There is no second account to switch to.' }
  const { data: other } = await admin
    .from('profiles')
    .select('id, role, email, linked_account_id, is_banned')
    .eq('id', me.linked_account_id as string)
    .maybeSingle()
  const otherR = other?.role === 'academy' ? 'parent' : (other?.role as string | null)
  if (!other || otherR !== role || other.linked_account_id !== user.id) {
    return { ok: false, status: 403, error: 'There is no second account to switch to.' }
  }
  if (other.is_banned) return { ok: false, status: 403, error: 'That account is not available.' }
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: other.email as string })
  const tokenHash = link?.properties?.hashed_token
  if (!tokenHash) return { ok: false, status: 500, error: 'Could not switch right now. Please try again.' }
  const { error } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash })
  if (error) return { ok: false, status: 500, error: 'Could not switch right now. Please try again.' }
  await logActivity({ userId: other.id as string, event: 'login', meta: { via: 'role_picker' } })
  return { ok: true, role }
}

/** Does the signed-in account have a linked second-role account? */
export async function linkedRoles(userId: string): Promise<MemberRole[] | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const { data: me } = await admin.from('profiles').select('role, linked_account_id').eq('id', userId).maybeSingle()
  if (!me?.linked_account_id) return null
  const { data: other } = await admin.from('profiles').select('role, linked_account_id').eq('id', me.linked_account_id as string).maybeSingle()
  if (!other || other.linked_account_id !== userId) return null
  const norm = (r: unknown) => (r === 'academy' ? 'parent' : (r as MemberRole))
  return [norm(me.role), norm(other.role)]
}
