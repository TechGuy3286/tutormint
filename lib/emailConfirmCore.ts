// lib/emailConfirmCore.ts
//
// "Email confirmation no longer blocks onboarding" (owner, 13 Oct 2026) — the
// PURE half (scripts/test-email-confirm.ts).
//
// A tutor who signs up with an email is signed in at once. They verify a mobile
// by SMS before the onboarding steps (that part is unchanged: a verified mobile
// is required), and can finish onboarding and pay while the email is still
// unconfirmed. The email is confirmed by OUR OWN link, whenever they click it;
// until then profiles.email_pending_confirm is true, the dashboard shows a
// gentle reminder with "Resend email", and no other email is sent to that
// address (a mistyped address must not receive someone else's mail).

import { createHmac, timingSafeEqual } from 'node:crypto'

export const CONFIRM_EMAIL_PATH = '/api/auth/confirm-email'

/** The signature in a confirmation link: only we can make one for (account, address). */
export function confirmEmailSig(userId: string, email: string, secret: string): string {
  return createHmac('sha256', secret).update(`confirm-email:${userId}:${email.trim().toLowerCase()}`).digest('hex').slice(0, 40)
}

export function confirmEmailSigValid(userId: string, email: string, sig: string, secret: string): boolean {
  if (!secret || !userId || !email || !sig) return false
  const expected = Buffer.from(confirmEmailSig(userId, email, secret))
  const given = Buffer.from(sig)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/** The link in the email. */
export function confirmEmailUrl(origin: string, userId: string, email: string, secret: string): string {
  const q = new URLSearchParams({ u: userId, e: email.trim().toLowerCase(), s: confirmEmailSig(userId, email, secret) })
  return `${origin.replace(/\/+$/, '')}${CONFIRM_EMAIL_PATH}?${q.toString()}`
}

export type EmailState = {
  /** profiles.email */
  email: string | null | undefined
  /** profiles.email_pending_confirm */
  pending: boolean | null | undefined
}

const SYNTHETIC = '@users.tutormint.org'

/** Show the dashboard reminder? Only a real address that is waiting for its link. */
export function emailReminderNeeded(s: EmailState): boolean {
  const e = (s.email ?? '').trim().toLowerCase()
  return !!s.pending && !!e && !e.endsWith(SYNTHETIC)
}

/** May this template be sent to this account's address? Only the confirmation
 *  email itself goes to an address that has not been confirmed. */
export function mayEmailAddress(s: EmailState, templateId: string): boolean {
  if (!s.pending) return true
  return templateId === 'confirm_email'
}

/**
 * What blocks a tutor from each stage. An unconfirmed email blocks NOTHING; an
 * unverified mobile blocks the onboarding steps (it is asked for first).
 */
export function tutorAccessWith(s: { emailPending: boolean; phoneVerified: boolean }): { signIn: boolean; onboarding: boolean; pay: boolean } {
  return { signIn: true, onboarding: s.phoneVerified, pay: s.phoneVerified }
}
