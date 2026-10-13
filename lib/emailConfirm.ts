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

/** A clicked link. True when the address is now (or was already) confirmed. */
export async function confirmEmailFromLink(input: { userId: string; email: string; sig: string }): Promise<{ ok: boolean; role: string | null; first: boolean }> {
  const admin = createAdminClient()
  if (!admin || !confirmEmailSigValid(input.userId, input.email, input.sig, secret())) return { ok: false, role: null, first: false }
  const { data: p } = await admin.from('profiles').select('email, role, email_pending_confirm').eq('id', input.userId).maybeSingle()
  // The link is for one address: if the account's email has changed since, it no longer applies.
  if (!p || ((p.email as string | null) ?? '').trim().toLowerCase() !== input.email.trim().toLowerCase()) return { ok: false, role: null, first: false }
  const role = (p.role as string | null) ?? null
  if (!p.email_pending_confirm) return { ok: true, role, first: false }
  const { error } = await admin.from('profiles').update({ email_pending_confirm: false, email_verified: true }).eq('id', input.userId)
  if (error) return { ok: false, role, first: false }
  await logActivity({ userId: input.userId, event: 'email_confirmed', targetType: 'profile', targetId: input.userId, meta: {} }).catch(() => undefined)
  return { ok: true, role, first: true }
}
