// lib/email/policyCore.ts — PURE. Which emails are sent, skipped or held
// (owner, 27 Oct 2026). Read by lib/email/policy.ts (the facts) and
// lib/email/send.ts (the one send path), so every email follows these rules:
//
//   1. never to an empty address or an auto-made @users.tutormint.org
//      placeholder;
//   2. never a type the Owner switched off in Notification settings;
//   3. never to an address on the Do not email list (Resend reported a bounce
//      or a complaint);
//   4. an unconfirmed address gets the confirmation email and nothing else;
//   5. CRITICAL emails (email confirmation, password reset, account erase
//      confirmation, bank transfer waiting for approval to the Owner) are then
//      always sent;
//   6. the same template to the same person at most once in 24 hours;
//   7. after 3 unopened emails of one type to one person, that type stops for
//      them (only while open tracking is active);
//   8. non-urgent member emails are held for one daily summary per person;
//   9. at 90% of the daily limit, only critical emails go; the rest are held
//      for the next day.

export const PLACEHOLDER_DOMAIN = /@users\.tutormint\.org$/i

/** Always sent (rules 6–9 never hold them back). */
export const CRITICAL_TEMPLATES = new Set(['confirm_email', 'password_reset', 'account_erased', 'bank_transfer_pending'])

/** Non-urgent member emails, combined into one daily summary per person. */
export const SUMMARY_TEMPLATES = new Set(['welcome', 'tuition_match', 'tuition_paused', 'message_digest'])

/** Staff and admin alert emails (Notification settings, default off — except
 *  the bank-transfer one, which is critical and on). */
export const STAFF_TEMPLATES = ['bank_transfer_pending', 'payment_alert', 'documents_reuploaded', 'duplicate_cnic', 'owner_alert', 'sms_alert', 'content_digest'] as const

/** The member emails (default on). */
export const MEMBER_TEMPLATES = [
  'confirm_email',
  'account_erased',
  'welcome',
  'verification_decision',
  'application_progress',
  'message_digest',
  'plan_activated',
  'verification_fee_paid',
  'plan_granted',
  'plan_expiring',
  'plan_expired',
  'account_banned',
  'tutor_alert',
  'admin_message',
  'staff_invite',
  'switched_tutor_signin',
  'account_type_changed',
  'tuition_paused',
  'refund_recorded',
  'verification_rejected',
  'document_approved',
  'tuition_match',
  'daily_summary',
] as const

/** Shown in Notification settings and never switchable off: the ways back into
 *  an account. Password reset is sent by the sign-in system itself. */
export const LOCKED_ON = new Set(['confirm_email', 'password_reset', 'account_erased'])

export const EMAIL_TYPE_LABEL: Record<string, string> = {
  bank_transfer_pending: 'Bank transfer waiting for approval (to the Owner)',
  password_reset: 'Password reset',
  confirm_email: 'Email confirmation',
  account_erased: 'Account erase confirmation',
  payment_alert: 'New payment received',
  documents_reuploaded: 'Documents re-uploaded',
  duplicate_cnic: 'CNIC already on another account',
  owner_alert: 'Owner alerts (changes and blocked attempts)',
  sms_alert: 'SMS may not be sending',
  content_digest: 'Monday blog suggestions',
  welcome: 'Welcome',
  verification_decision: 'Verification decision',
  application_progress: 'Shortlisted / hired',
  message_digest: 'New messages',
  plan_activated: 'Plan activated (receipt)',
  verification_fee_paid: 'Verification Fee receipt',
  plan_granted: 'Plan granted',
  plan_expiring: 'Plan ending soon',
  plan_expired: 'Plan ended',
  account_banned: 'Account banned',
  tutor_alert: 'A matching tutor joined',
  admin_message: 'Message from the TutorMint Team',
  staff_invite: 'Staff invite',
  switched_tutor_signin: 'Sign-in changed (one-time)',
  account_type_changed: 'Account type changed',
  tuition_paused: 'Tuition paused',
  refund_recorded: 'Refund recorded',
  verification_rejected: 'Document not approved',
  document_approved: 'Document approved',
  tuition_match: 'Matching tuitions',
  daily_summary: 'Daily summary',
}

export const EMAIL_TYPE_KEY_PREFIX = 'email.type.'
export const DAILY_LIMIT_KEY = 'email.daily_limit'
export const OPEN_TRACKING_KEY = 'email.open_tracking'
export const DEFAULT_DAILY_LIMIT = 100
export const LIMIT_SHARE = 0.9
export const UNOPENED_LIMIT = 3
export const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000

export function isStaffTemplate(t: string): boolean {
  return (STAFF_TEMPLATES as readonly string[]).includes(t)
}

/** Default when the Owner has not set a switch: staff alerts off (the
 *  bank-transfer one on), member emails on. */
export function defaultOn(template: string): boolean {
  if (template === 'bank_transfer_pending') return true
  return !isStaffTemplate(template)
}

/** Is this email type on, given the stored value ('on' / 'off' / missing)? */
export function typeOn(template: string, stored: string | null | undefined): boolean {
  if (LOCKED_ON.has(template)) return true
  const v = (stored ?? '').trim().toLowerCase()
  if (v === 'on') return true
  if (v === 'off') return false
  return defaultOn(template)
}

/** The daily limit from its setting (a whole number ≥ 1), else the default. */
export function parseDailyLimit(v: string | null | undefined): number {
  const n = Number(String(v ?? '').trim())
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_DAILY_LIMIT
}

/** From this many sent today, only critical emails go (90 of 100). */
export function criticalOnlyFrom(limit: number): number {
  return Math.floor(limit * LIMIT_SHARE)
}

export function isPlaceholder(address: string | null | undefined): boolean {
  return PLACEHOLDER_DOMAIN.test(String(address ?? '').trim())
}

export const normaliseAddress = (a: string) => a.trim().toLowerCase()

/** How many of the newest sends of one type to one person in a row were
 *  never opened (newest first; stops at the first opened one). */
export function unopenedStreak(sends: { openedAt: string | null }[]): number {
  let n = 0
  for (const s of sends) {
    if (s.openedAt) break
    n++
  }
  return n
}

export type PolicyFacts = {
  typeOff: Set<string>
  doNotEmail: Set<string> // normalised addresses
  unconfirmed: Set<string> // normalised addresses waiting for their confirmation link
  /** `${template}|${address}` sent in the last 24 hours. */
  recent: Set<string>
  /** `${template}|${address}` → unopened streak (only when tracking is active). */
  unopened: Map<string, number>
  trackingActive: boolean
  sentToday: number
  limit: number
}

export const NO_FACTS: PolicyFacts = {
  typeOff: new Set(),
  doNotEmail: new Set(),
  unconfirmed: new Set(),
  recent: new Set(),
  unopened: new Map(),
  trackingActive: false,
  sentToday: 0,
  limit: DEFAULT_DAILY_LIMIT,
}

export type Decision = { action: 'send' } | { action: 'skip'; reason: string } | { action: 'queue'; kind: 'daily_limit' | 'summary'; reason: string }

export type PolicyMessage = { to: string; template?: string | null }

/**
 * Decide every message of a send, in order. Sends counted as they are decided,
 * so a batch that crosses 90% holds back the rest of itself. `fromQueue` is a
 * held email being sent now: it is never held for a summary again, and the
 * drain has already checked the day's room.
 */
export function decideAll(messages: readonly PolicyMessage[], facts: PolicyFacts, opts: { fromQueue?: boolean } = {}): Decision[] {
  let sent = facts.sentToday
  const threshold = criticalOnlyFrom(facts.limit)
  const seen = new Set<string>()
  return messages.map((m) => {
    const t = m.template ?? 'email'
    const addr = normaliseAddress(m.to ?? '')
    if (!addr) return { action: 'skip', reason: 'empty address' }
    if (isPlaceholder(addr)) return { action: 'skip', reason: 'placeholder address (no mailbox)' }
    if (facts.typeOff.has(t)) return { action: 'skip', reason: 'email type switched off' }
    if (facts.doNotEmail.has(addr)) return { action: 'skip', reason: 'do not email (bounced or complained)' }
    if (facts.unconfirmed.has(addr) && t !== 'confirm_email') return { action: 'skip', reason: 'email address not confirmed yet' }
    if (CRITICAL_TEMPLATES.has(t)) {
      sent++
      return { action: 'send' }
    }
    const key = `${t}|${addr}`
    if (facts.recent.has(key) || seen.has(key)) return { action: 'skip', reason: 'same email sent in the last 24 hours' }
    if (facts.trackingActive && (facts.unopened.get(key) ?? 0) >= UNOPENED_LIMIT) return { action: 'skip', reason: '3 unopened emails of this type' }
    if (!opts.fromQueue && SUMMARY_TEMPLATES.has(t)) {
      seen.add(key)
      return { action: 'queue', kind: 'summary', reason: 'held for the daily summary' }
    }
    if (!opts.fromQueue && sent >= threshold) {
      seen.add(key)
      return { action: 'queue', kind: 'daily_limit', reason: 'daily limit reached; sent tomorrow' }
    }
    seen.add(key)
    sent++
    return { action: 'send' }
  })
}

/** How many held emails the drain may send now (room under 90%). */
export function roomToday(sentToday: number, limit: number): number {
  return Math.max(0, criticalOnlyFrom(limit) - sentToday)
}

/** The plain text of one email without its footer, for the daily summary. */
export function summaryItemText(text: string | null | undefined): string {
  const t = String(text ?? '')
  const cut = t.search(/\n(?:Stop these tuition emails:|You are getting this|© 2026)/)
  return (cut >= 0 ? t.slice(0, cut) : t).trim()
}

export type HeldRow = { id: string; recipient: string; template: string | null; subject: string | null; text: string | null; createdAt: string }

/** Held summary emails grouped into one summary per person (oldest first).
 *  Repeated "new messages" digests collapse to the newest one. */
export function groupSummaries(rows: readonly HeldRow[]): { recipient: string; ids: string[]; items: { subject: string; text: string }[] }[] {
  const by = new Map<string, HeldRow[]>()
  for (const r of [...rows].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
    const k = normaliseAddress(r.recipient)
    const list = by.get(k) ?? []
    list.push(r)
    by.set(k, list)
  }
  return [...by.values()].map((list) => {
    const lastDigest = [...list].reverse().find((r) => r.template === 'message_digest')
    const kept = list.filter((r) => r.template !== 'message_digest' || r === lastDigest)
    return {
      recipient: list[0].recipient,
      ids: list.map((r) => r.id),
      items: kept.map((r) => ({ subject: r.subject ?? 'Update', text: summaryItemText(r.text) })),
    }
  })
}

/** The masked form of an address for the Do not email list: a•••@gmail.com. */
export function maskAddress(a: string): string {
  const s = normaliseAddress(a)
  const at = s.lastIndexOf('@')
  if (at <= 0) return '•••'
  return `${s[0]}•••${s.slice(at)}`
}

/** No email address, phone run or long digit run in a log line. */
export function logLineSafe(line: string): boolean {
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(line)) return false
  return !/\d{7,}/.test(line.replace(/[\s-]/g, ''))
}
