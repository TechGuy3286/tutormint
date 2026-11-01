// lib/emailChangeCore.ts
//
// One email per "add or change my email" (owner, 31 Oct 2026) — the PURE half
// (scripts/test-email-change.ts).
//
// Supabase's own email change (supabase.auth.updateUser({ email })) with its
// "Secure email change" setting mails TWO addresses every time: the current
// sign-in address and the new one. For a mobile sign-up the current address is
// the no-mailbox placeholder <msisdn>@users.tutormint.org, and a re-submit of
// the same address sent the pair again. Between 17 and 31 Oct 2026 most of
// Supabase's SMTP sends came in such pairs.
//
// Now every member email change is OURS: the new address is held on the auth
// user's app_metadata (which only the server can write), ONE TutorMint
// confirmation goes to it, and the sign-in address changes only when the link
// is clicked (lib/emailConfirm confirmEmailFromLink). Supabase is never asked to
// send anything, so the dashboard setting no longer matters.

import { isSyntheticEmail } from "@/lib/phone"
import { recipientProblem } from "@/lib/notify/recipient"
import { maskEmailDisplay } from "@/lib/contactMaskCore"

/** app_metadata keys holding a change that waits for its link. */
export const PENDING_EMAIL_KEY = 'tm_pending_email'
export const PENDING_EMAIL_AT_KEY = 'tm_pending_email_at'

/** A repeat of the same address inside this window is the same request. */
export const RESEND_GUARD_MS = 60_000

export type EmailChangeDecision =
  | { kind: 'send' }
  | { kind: 'already_sent' }
  | { kind: 'same_as_current' }

/**
 * What a submitted address means.
 *  - the confirmed sign-in address already (and it is a real one) → nothing to do;
 *  - the same address that is already waiting, asked again within a minute
 *    (a double tap, or Back then Next) → do not send again;
 *  - anything else → send one confirmation.
 */
export function emailChangeDecision(input: {
  email: string
  currentAuthEmail: string | null | undefined
  pendingEmail: string | null | undefined
  pendingAt: string | null | undefined
  now: number
}): EmailChangeDecision {
  const e = input.email.trim().toLowerCase()
  const cur = (input.currentAuthEmail ?? '').trim().toLowerCase()
  if (cur && cur === e && !cur.endsWith('@users.tutormint.org')) return { kind: 'same_as_current' }
  const pend = (input.pendingEmail ?? '').trim().toLowerCase()
  const at = input.pendingAt ? Date.parse(input.pendingAt) : NaN
  if (pend && pend === e && Number.isFinite(at) && input.now - at >= 0 && input.now - at < RESEND_GUARD_MS) {
    return { kind: 'already_sent' }
  }
  return { kind: 'send' }
}

/** The pending change a link may complete: only the exact address that is waiting. */
export function pendingChangeMatches(pendingEmail: unknown, linkEmail: string): boolean {
  return typeof pendingEmail === 'string' && pendingEmail.trim().toLowerCase() === linkEmail.trim().toLowerCase() && !!linkEmail.trim()
}

/**
 * The security notice after a change (owner, 1 Nov 2026): when the OLD sign-in
 * address was a real email (not the mobile placeholder, not an erased account),
 * it gets ONE short notice naming the new address masked — no link, no undo.
 * Null when there is nobody to tell.
 */
export function oldAddressNotice(oldEmail: string | null | undefined, newEmail: string): { to: string; maskedNew: string } | null {
  const old = (oldEmail ?? '').trim().toLowerCase()
  const next = newEmail.trim().toLowerCase()
  if (!old || old === next || isSyntheticEmail(old) || recipientProblem(old)) return null
  const maskedNew = maskEmailDisplay(next)
  if (!maskedNew) return null
  return { to: old, maskedNew }
}
