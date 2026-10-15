// lib/ownerAlertCore.ts
//
// PURE rules for the Owner alert (owner, 13 Oct 2026): when anyone other than
// the Owner changes bank transfer details, payment gateway settings, plan
// prices or team roles, the Owner is told who, what, before → after, and when.
//
// An account number or IBAN is NEVER written in full — only its last 4 digits —
// in the alert, the email and the audit log.

import type { AdminRole } from '@/lib/adminAccessCore'

/** Who must be told about: every actor except the Owner. */
export function shouldAlertOwner(actorRole: AdminRole | null | undefined): boolean {
  return actorRole !== 'owner'
}

/** "•••• 1949" for an account number or IBAN; "(empty)" when nothing is set. */
export function maskAccount(value: string | null | undefined): string {
  const raw = (value ?? '').replace(/[^0-9A-Za-z]/g, '')
  if (!raw) return '(empty)'
  return `•••• ${raw.slice(-4)}`
}

/** Fields whose values are account identifiers and must be masked. */
export const MASKED_BANK_FIELDS = ['accountNumber', 'iban'] as const

export type AlertChange = { label: string; before: string; after: string }

/** The value as shown: masked for an account field, "(empty)" for nothing. */
export function shownValue(field: string, value: string | null | undefined): string {
  if ((MASKED_BANK_FIELDS as readonly string[]).includes(field)) return maskAccount(value)
  const v = (value ?? '').trim()
  return v || '(empty)'
}

/** Only what actually changed, each as before → after. */
export function changedFields(
  fields: { field: string; label: string }[],
  before: Record<string, string | null | undefined>,
  after: Record<string, string | null | undefined>,
): AlertChange[] {
  const out: AlertChange[] = []
  for (const f of fields) {
    const b = (before[f.field] ?? '').trim()
    const a = (after[f.field] ?? '').trim()
    if (b === a) continue
    out.push({ label: f.label, before: shownValue(f.field, b), after: shownValue(f.field, a) })
  }
  return out
}

/** One line per change: "Bank name: Faysal Bank → Meezan Bank". */
export function changeLines(changes: AlertChange[]): string[] {
  return changes.map((c) => `${c.label}: ${c.before} → ${c.after}`)
}

/** Pakistan time, e.g. "13 Oct 2026, 2:05 pm (Pakistan time)". */
export function pakistanTime(when: Date): string {
  const d = when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' })
  const t = when
    .toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Karachi' })
    .toLowerCase()
  return `${d}, ${t} (Pakistan time)`
}

/**
 * Should a REFUSED action raise the blocked-attempt alert (owner, 15 Oct 2026)?
 * Only when the refusal came from Owner protection — someone other than the
 * Owner tried to change the Owner account (edit, pause, remove, demote, email,
 * mobile, password, two-factor) or to make anyone Owner. A Partner-protection
 * refusal, or any other 403, is not this alert.
 */
export function isOwnerProtectionRefusal(problem: string | null | undefined, ownerProtected: string, ownerOnly: string): boolean {
  return !!problem && (problem === ownerProtected || problem === ownerOnly)
}

/** The in-app body for a blocked attempt: who, what they tried, when. */
export function blockedAttemptBody(who: string, what: string, when: Date): string {
  return [`By ${who}`, `Tried to: ${what}`, 'Refused by Owner protection — nothing changed.', pakistanTime(when)].join('\n')
}

/** The in-app body: who, what changed, when. */
export function alertBody(who: string, changes: AlertChange[], when: Date): string {
  return [`By ${who}`, ...changeLines(changes), pakistanTime(when)].join('\n')
}
