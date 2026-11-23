// lib/otpAlertsCore.ts — PURE rules of the OTP-verified alert emails (owner,
// 23 Nov 2026 — PR-18 Part C). Unit tests: scripts/test-pr18.ts.
//
// When a member verifies their mobile, the chosen staff get an email within a
// minute: "New verified tutor: <name>, <city>" (or parent). The body has the
// name, role, city, sign-up time, steps done (X of 16 for tutors) and an
// "Open in admin" button — never a phone, email, CNIC or rupees.
//
// Recipients: the Owner-only setting 'alerts.otp_recipients' (a JSON array of
// staff profile ids; default the Owner + Mohsin). Optional 15-minute digest
// ('alerts.otp_digest' = 'on'; off by default).
//
// Resend is on the Free plan (100 emails a day). Alerts must never starve
// platform emails: once the day's sent emails plus this alert would pass 80,
// alerts stop for the rest of the (UTC, Resend's) day and the Owner's bell
// rings once. Receipts, OTP codes and member emails always go first (they are
// not touched; the 90-of-100 rule in lib/email/policyCore still guards them).

import { BRAND } from '@/lib/brand'

export const RECIPIENTS_KEY = 'alerts.otp_recipients'
export const DIGEST_KEY = 'alerts.otp_digest'
export const DIGEST_LAST_KEY = 'alerts.otp_digest_last'
export const LIMIT_BELL_KEY = 'alerts.otp_limit_belled'
export const OTP_ALERT_TEMPLATE = 'otp_alert'
export const DIGEST_MINUTES = 15
/** Alerts stop at this share of the daily email limit (80 of 100). */
export const ALERT_SHARE = 0.8
export const SITE = 'https://www.tutormint.org'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseRecipients(value: string | null | undefined): string[] {
  try {
    const v = JSON.parse(value ?? '[]') as unknown
    if (!Array.isArray(v)) return []
    return [...new Set(v.filter((x): x is string => typeof x === 'string' && UUID.test(x)).map((x) => x.toLowerCase()))]
  } catch {
    return []
  }
}

export function digestOn(value: string | null | undefined): boolean {
  return String(value ?? '').trim().toLowerCase() === 'on'
}

/** Alerts stop from this many emails sent today (80 of 100). */
export function alertStopAt(dailyLimit: number): number {
  return Math.floor(Math.max(1, dailyLimit) * ALERT_SHARE)
}

/** May `emails` more alert emails go today? */
export function alertRoom(sentToday: number, emails: number, dailyLimit: number): boolean {
  return emails > 0 && sentToday + emails <= alertStopAt(dailyLimit)
}

/** The setting's warning: alerts plus the other emails would pass 80 a day. */
export function budgetWarning(a: { otherPerDay: number; verifiedPerDay: number; recipients: number; digest: boolean; dailyLimit: number }): string | null {
  const alerts = a.digest ? Math.min(a.verifiedPerDay, Math.round((24 * 60) / DIGEST_MINUTES)) * a.recipients : a.verifiedPerDay * a.recipients
  const total = Math.round(a.otherPerDay + alerts)
  const stop = alertStopAt(a.dailyLimit)
  if (total <= stop) return null
  return `About ${total} emails a day with these alerts — more than ${stop}. Alerts stop for the day at ${stop} so platform emails still go. Choose fewer people or the 15-minute digest.`
}

export type AlertMember = {
  id: string
  name: string
  role: 'tutor' | 'parent'
  city: string | null
  signedUpAt: string
  /** Tutors: "X of 16". */
  steps: { done: number; total: number } | null
}

function pkTime(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(d)
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function adminHref(memberId: string): string {
  return `${SITE}/admin/users/${memberId}`
}

export function alertSubject(m: AlertMember): string {
  return `New verified ${m.role}: ${m.name || 'New member'}${m.city ? `, ${m.city}` : ''}`
}

function lines(m: AlertMember): string[] {
  return [
    `Name: ${m.name || 'New member'}`,
    `Role: ${m.role === 'tutor' ? 'Tutor' : 'Parent'}`,
    `City: ${m.city || 'Not given yet'}`,
    `Signed up: ${pkTime(m.signedUpAt)} (Pakistan time)`,
    ...(m.steps ? [`Steps done: ${m.steps.done} of ${m.steps.total}`] : []),
  ]
}

const BUTTON = (href: string) =>
  `<a href="${esc(href)}" style="display:inline-block;background:${BRAND.navy};color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px">Open in admin</a>`

export function alertEmail(m: AlertMember): { subject: string; text: string; html: string } {
  const href = adminHref(m.id)
  const ls = lines(m)
  return {
    subject: alertSubject(m),
    text: [`A ${m.role} just verified their mobile number on TutorMint.`, '', ...ls, '', `Open in admin: ${href}`].join('\n'),
    html: `<p>A ${m.role} just verified their mobile number on TutorMint.</p><p>${ls.map(esc).join('<br>')}</p><p>${BUTTON(href)}</p>`,
  }
}

export function digestEmail(ms: AlertMember[]): { subject: string; text: string; html: string } {
  const n = ms.length
  const subject = `${n} new verified ${n === 1 ? 'member' : 'members'} on TutorMint`
  const text = [
    `Verified their mobile in the last ${DIGEST_MINUTES} minutes:`,
    '',
    ...ms.map((m) => `- ${alertSubject(m).replace(/^New verified /, '')}${m.steps ? ` (${m.steps.done} of ${m.steps.total} steps)` : ''}: ${adminHref(m.id)}`),
  ].join('\n')
  const html = `<p>Verified their mobile in the last ${DIGEST_MINUTES} minutes:</p><ul>${ms
    .map((m) => `<li>${esc(alertSubject(m).replace(/^New verified /, ''))}${m.steps ? ` (${m.steps.done} of ${m.steps.total} steps)` : ''} — <a href="${esc(adminHref(m.id))}">Open in admin</a></li>`)
    .join('')}</ul>`
  return { subject, text, html }
}

/** Is a digest due (15 minutes since the last one)? */
export function digestDue(lastIso: string | null | undefined, nowMs: number): boolean {
  const t = Date.parse(lastIso ?? '')
  return !Number.isFinite(t) || nowMs - t >= DIGEST_MINUTES * 60_000
}

/** Nothing personal beyond the name and city may be in an alert. */
export function alertTextSafe(text: string): boolean {
  if (/@/.test(text.replace(/https:\/\/www\.tutormint\.org\S*/g, ''))) return false
  if (/(\+?92|0)3\d{2}[\s-]?\d{7}/.test(text)) return false
  if (/\d{5}-?\d{7}-?\d/.test(text)) return false
  if (/\bRs\.?\s?\d|rupees/i.test(text)) return false
  return true
}
