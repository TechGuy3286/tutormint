import 'server-only'

// lib/emailConfirm.ts
//
// The server half of our own email confirmation (owner, 13 Oct 2026). Rules and
// the link format: lib/emailConfirmCore.

import { createAdminClient } from '@/lib/supabase/admin'
import { deliverEmail } from '@/lib/notify'
import { logActivity } from '@/lib/activityLog'
import { isSyntheticEmail } from '@/lib/phone'
import { SITE_URL } from '@/lib/siteUrl'
import { confirmEmailSigValid, confirmEmailUrl } from '@/lib/emailConfirmCore'
import { PENDING_EMAIL_AT_KEY, PENDING_EMAIL_KEY, emailChangeDecision, pendingChangeMatches } from '@/lib/emailChangeCore'

// The same server-only secret lib/matchEmail signs with. Never sent to a browser.
const secret = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

/** Send (or resend) the confirmation link to the account's own address. */
export async function sendConfirmEmail(userId: string, origin: string = SITE_URL): Promise<{ ok: boolean; reason?: string }> {
  const admin = createAdminClient()
  if (!admin || !secret()) return { ok: false, reason: 'unavailable' }
  const { data: p } = await admin.from('profiles').select('email, full_name, email_pending_confirm').eq('id', userId).maybeSingle()
  const email = ((p?.email as string | null) ?? '').trim().toLowerCase()
  if (!p || !email || isSyntheticEmail(email)) return { ok: false, reason: 'no email' }
  if (!p.email_pending_confirm) return { ok: false, reason: 'already confirmed' }
  const result = await deliverEmail(
    { userId },
    { id: 'confirm_email', name: (p.full_name as string | null) ?? '', url: confirmEmailUrl(origin, userId, email, secret()) },
  )
  return result.ok ? { ok: true } : { ok: false, reason: result.reason }
}

/**
 * A member adds or changes their email (owner, 31 Oct 2026): ONE TutorMint
 * confirmation to the new address, nothing to the old one. The address waits
 * on the auth user's app_metadata (server-written only) until the link is
 * clicked; the sign-in address and profiles.email do not change before that.
 * Rules: lib/emailChangeCore.
 */
export async function requestEmailChange(input: {
  userId: string
  email: string
  currentAuthEmail: string | null
  appMetadata: Record<string, unknown> | null | undefined
  origin?: string
}): Promise<{ ok: true; sent: boolean } | { ok: false; reason: string; status: number }> {
  const admin = createAdminClient()
  if (!admin || !secret()) return { ok: false, reason: 'unavailable', status: 503 }
  const email = input.email.trim().toLowerCase()
  const decision = emailChangeDecision({
    email,
    currentAuthEmail: input.currentAuthEmail,
    pendingEmail: (input.appMetadata?.[PENDING_EMAIL_KEY] as string | undefined) ?? null,
    pendingAt: (input.appMetadata?.[PENDING_EMAIL_AT_KEY] as string | undefined) ?? null,
    now: Date.now(),
  })
  if (decision.kind === 'same_as_current') return { ok: false, reason: 'That is already your email address.', status: 400 }
  if (decision.kind === 'already_sent') return { ok: true, sent: false }

  const { error } = await admin.auth.admin.updateUserById(input.userId, {
    app_metadata: { [PENDING_EMAIL_KEY]: email, [PENDING_EMAIL_AT_KEY]: new Date().toISOString() },
  })
  if (error) return { ok: false, reason: 'unavailable', status: 503 }
  const { data: p } = await admin.from('profiles').select('full_name').eq('id', input.userId).maybeSingle()
  const result = await deliverEmail(
    { email, name: (p?.full_name as string | null) ?? '' },
    { id: 'confirm_email', name: (p?.full_name as string | null) ?? '', url: confirmEmailUrl(input.origin ?? SITE_URL, input.userId, email, secret()) },
  )
  if (!result.ok) return { ok: false, reason: 'We could not send the confirmation email. Please try again.', status: 502 }
  return { ok: true, sent: true }
}

/** Complete a change that waited on app_metadata: the link's address becomes
 *  the sign-in address and profiles.email. False when nothing matches. */
async function completePendingChange(userId: string, email: string): Promise<{ ok: boolean; role: string | null }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, role: null }
  const { data: got } = await admin.auth.admin.getUserById(userId)
  const pending = got?.user?.app_metadata?.[PENDING_EMAIL_KEY]
  if (!pendingChangeMatches(pending, email)) return { ok: false, role: null }
  const e = email.trim().toLowerCase()
  const { error } = await admin.auth.admin.updateUserById(userId, {
    email: e,
    email_confirm: true,
    app_metadata: { [PENDING_EMAIL_KEY]: null, [PENDING_EMAIL_AT_KEY]: null },
  })
  if (error) return { ok: false, role: null }
  const { data: p } = await admin
    .from('profiles')
    .update({ email: e, email_verified: true, email_pending_confirm: false })
    .eq('id', userId)
    .select('role')
    .maybeSingle()
  await logActivity({ userId, event: 'email_confirmed', targetType: 'profile', targetId: userId, meta: { changed: true } }).catch(() => undefined)
  return { ok: true, role: (p?.role as string | null) ?? null }
}

/** A clicked link. True when the address is now (or was already) confirmed. */
export async function confirmEmailFromLink(input: { userId: string; email: string; sig: string }): Promise<{ ok: boolean; role: string | null; first: boolean }> {
  const admin = createAdminClient()
  if (!admin || !confirmEmailSigValid(input.userId, input.email, input.sig, secret())) return { ok: false, role: null, first: false }
  const { data: p } = await admin.from('profiles').select('email, role, email_pending_confirm').eq('id', input.userId).maybeSingle()
  // The link is for one address. A change waiting on app_metadata is completed
  // here; otherwise, if the account's email has changed since, it no longer applies.
  if (p && ((p.email as string | null) ?? '').trim().toLowerCase() !== input.email.trim().toLowerCase()) {
    const changed = await completePendingChange(input.userId, input.email)
    return changed.ok ? { ok: true, role: changed.role, first: true } : { ok: false, role: null, first: false }
  }
  if (!p) return { ok: false, role: null, first: false }
  const role = (p.role as string | null) ?? null
  if (!p.email_pending_confirm) return { ok: true, role, first: false }
  const { error } = await admin.from('profiles').update({ email_pending_confirm: false, email_verified: true }).eq('id', input.userId)
  if (error) return { ok: false, role, first: false }
  await logActivity({ userId: input.userId, event: 'email_confirmed', targetType: 'profile', targetId: input.userId, meta: {} }).catch(() => undefined)
  return { ok: true, role, first: true }
}
