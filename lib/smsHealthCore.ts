// lib/smsHealthCore.ts — the pure rules of SMS health (owner, 15 Oct 2026).
//
// No I/O, so every rule here is unit-tested (npm run test:smshealth):
//   • how a number is written into the SMS log (masked — 0321•••••22),
//   • how a provider's error text is scrubbed before it is stored,
//   • the "Send test SMS" wording, and the value put into SendPK's template,
//   • when the hourly check emails the Owner, and the 6-hour limit.
//
// NEVER a full number, a code or a message body in anything this builds.

import { normalisePkMobile } from '@/lib/phone'

export type SmsPurpose = 'signup' | 'verify' | 'reset' | 'test' | 'alert'
/** sent / failed = a real send attempt; reused = a live code already existed,
 *  nothing sent; not_sent = handled without a provider (bridge code). */
export type SmsOutcome = 'sent' | 'failed' | 'reused' | 'not_sent'

export const SMS_RETENTION_DAYS = 90
export const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000
export const QUIET_WINDOW_MS = 12 * 60 * 60 * 1000
/** Signups that reached the mobile step in the quiet window before it is an alert. */
export const QUIET_MIN_REQUESTS = 2
export const SMS_TEST_PER_HOUR = 5

const DOTS = '•••••'

/** 0321•••••22 — the first four and last two digits of the local form. Anything
 *  that is not a Pakistani mobile is written as dots only. */
export function maskMobile(raw: string | null | undefined): string {
  const msisdn = normalisePkMobile(String(raw ?? ''))
  if (!msisdn) return '•••'
  const local = `0${msisdn.slice(2)}`
  return `${local.slice(0, 4)}${DOTS}${local.slice(-2)}`
}

/** A provider's error text as stored: any run of 6+ digits, spaces or dashes
 *  allowed between them (a number or a code echoed back), is replaced with dots,
 *  and it is cut to 200 characters. */
export function scrubSmsError(text: string | null | undefined): string | null {
  const t = String(text ?? '').trim()
  if (!t) return null
  return t.replace(/\+?\d(?:[\s-]?\d){5,}/g, '•••').slice(0, 200)
}

export type SmsLogRow = {
  purpose: SmsPurpose
  to_masked: string
  provider: string | null
  outcome: SmsOutcome
  message_id: string | null
  error: string | null
  actor_id: string | null
}

/** The row written for one code request or send. Takes the raw number and masks
 *  it here, so no caller can store it unmasked by mistake. */
export function smsLogRow(o: {
  purpose: SmsPurpose
  phone: string
  outcome: SmsOutcome
  provider?: string | null
  messageId?: string | null
  error?: string | null
  actorId?: string | null
}): SmsLogRow {
  return {
    purpose: o.purpose,
    to_masked: maskMobile(o.phone),
    provider: o.provider ?? null,
    outcome: o.outcome,
    message_id: o.messageId ? String(o.messageId).slice(0, 100) : null,
    error: o.outcome === 'failed' ? scrubSmsError(o.error) ?? 'failed' : null,
    actor_id: o.actorId ?? null,
  }
}

/** Pakistan time, e.g. "15 Oct 2026, 11:48 AM PKT". */
export function pkTime(at: Date | string | number): string {
  const d = new Date(at)
  const s = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d)
  return `${s.replace(/\b(am|pm)\b/, (m) => m.toUpperCase())} PKT`
}

/** The test message wording. */
export function smsTestMessage(now: Date): string {
  return `TutorMint SMS test — ${pkTime(now)}`
}

/**
 * SendPK sends ONLY its approved template ("Your TutorMint verification code is
 * #otp#…") and fills one variable from the first 4–8 digit run of the body it is
 * given. A test with no digits would be refused before it reaches SendPK. So the
 * test body carries the Pakistan time as six digits (HHMMSS) — that is the
 * number the phone shows; it is the time of the test, not a code, and it
 * verifies nothing.
 */
export function smsTestStamp(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('hour')}${get('minute')}${get('second')}`.replace(/^24/, '00')
}

/** The stamp goes FIRST: SendPK takes the first 4–8 digit run, and the message
 *  itself contains the year. */
export function smsTestBody(now: Date): string {
  return `${smsTestStamp(now)} ${smsTestMessage(now)}`
}

export type AlertFacts = {
  now: number
  /** Newest alert sent, or null. */
  lastAlertAt: number | null
  /** Failed send attempts newer than max(lastAlertAt, now − 12 h). */
  newFailures: number
  /** The purposes of those failures (signup, verify, reset, alert), for the alert text. */
  failedPurposes?: string[]
  /** Distinct (masked) numbers that asked for a signup/verify code in the last 12 h. */
  codeRequests12h: number
  /** Successful sends in the last 12 h. */
  successes12h: number
}

export type AlertDecision = { fire: boolean; reasons: string[]; heldByCooldown: boolean }

/** Fire when a send failed, OR 2+ numbers asked for a code in 12 h and none was
 *  sent — but never within 6 hours of the last alert. */
export function smsAlertDecision(f: AlertFacts): AlertDecision {
  const reasons: string[] = []
  if (f.newFailures > 0) {
    const kinds = [...new Set(f.failedPurposes ?? [])].sort()
    reasons.push(`${f.newFailures} SMS send attempt${f.newFailures === 1 ? '' : 's'} failed${kinds.length ? ` (${kinds.join(', ')})` : ''}.`)
  }
  if (f.codeRequests12h >= QUIET_MIN_REQUESTS && f.successes12h === 0) {
    reasons.push(`${f.codeRequests12h} signups reached the mobile step in the last 12 hours and no SMS was sent.`)
  }
  if (reasons.length === 0) return { fire: false, reasons, heldByCooldown: false }
  const held = f.lastAlertAt !== null && f.now - f.lastAlertAt < ALERT_COOLDOWN_MS
  return { fire: !held, reasons, heldByCooldown: held }
}

/** The start of the failure window: the newest alert, or 12 h ago if later. */
export function failureWindowStart(now: number, lastAlertAt: number | null): number {
  return Math.max(now - QUIET_WINDOW_MS, lastAlertAt ?? 0)
}

export function smsAlertMessage(lastSuccessAt: string | null): string {
  const when = lastSuccessAt ? pkTime(lastSuccessAt) : 'never (no successful SMS on record)'
  return `SMS may not be sending — last successful SMS at ${when}. Check Admin → Settings → SMS.`
}
