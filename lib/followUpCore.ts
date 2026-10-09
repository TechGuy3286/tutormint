// lib/followUpCore.ts
//
// One-tap follow-up for stuck sign-ups (owner, 9 Oct 2026) — the pure rules,
// shared by Overview "Stuck in onboarding", People → Unpaid signups and
// Abandoned signups so the three lists behave the same:
//
//   • A member followed up in the last FOLLOW_UP_HOLD_DAYS (7) days sits in the
//     list's "Follow-up sent" tab, with "Follow-up sent 2 days ago by Aqsa".
//   • Still stuck 7 days after the LAST follow-up, they return to the main tab
//     tagged "Followed up once" / "twice" / "3 times".
//   • An undone follow-up (Undo) counts for nothing.
//   • Paying / finishing onboarding drops a member from the list's own loader,
//     so both tabs lose them together.
//
// The WhatsApp text is an existing admin_message_templates row used AS IS; its
// placeholders are filled and the continue link goes on its own line after it
// (unless the template carries a {link} placeholder itself).
//
// PURE — unit-tested by scripts/test-follow-ups.ts.

export const FOLLOW_UP_HOLD_DAYS = 7
const DAY = 86_400_000

/** The template the stuck-in-onboarding WhatsApp button sends. */
export const STUCK_TEMPLATE_KEY = 'profile_completion_nudge'

export type FollowUpChannel = 'whatsapp' | 'call' | 'email'
export type FollowUpSource = 'stuck' | 'unpaid' | 'abandoned'

export type FollowUpRecord = {
  id: string
  member_id: string
  channel: FollowUpChannel
  template_key: string | null
  created_at: string
  staff_name: string | null
  staff_email: string | null
  undone_at: string | null
}

export type FollowUpState = {
  /** Live (not undone) follow-ups, newest first. */
  count: number
  lastAt: string | null
  lastBy: string | null
  lastId: string | null
  /** In the "Follow-up sent" tab right now. */
  sent: boolean
  /** On the main tab after a follow-up went unanswered: "Followed up once". */
  tag: string | null
}

export function timesWord(n: number): string {
  if (n === 1) return 'once'
  if (n === 2) return 'twice'
  return `${n} times`
}

/** A staff member's display name: their name, else the email's local part. */
export function staffLabel(name: string | null | undefined, email: string | null | undefined): string {
  const n = (name ?? '').trim()
  if (n) return n.split(/\s+/)[0]
  const e = (email ?? '').trim()
  return e ? e.split('@')[0] : 'staff'
}

export function followUpState(records: FollowUpRecord[], nowMs: number): FollowUpState {
  const live = records
    .filter((r) => !r.undone_at)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
  const last = live[0] ?? null
  if (!last) return { count: 0, lastAt: null, lastBy: null, lastId: null, sent: false, tag: null }
  const sent = nowMs - new Date(last.created_at).getTime() < FOLLOW_UP_HOLD_DAYS * DAY
  return {
    count: live.length,
    lastAt: last.created_at,
    lastBy: staffLabel(last.staff_name, last.staff_email),
    lastId: last.id,
    sent,
    tag: sent ? null : `Followed up ${timesWord(live.length)}`,
  }
}

/** "today", "1 day ago", "3 days ago". */
export function daysAgo(atIso: string, nowMs: number): string {
  const d = Math.floor((nowMs - new Date(atIso).getTime()) / DAY)
  if (d <= 0) return 'today'
  return d === 1 ? '1 day ago' : `${d} days ago`
}

/** "Follow-up sent 2 days ago by Aqsa". */
export function followUpLine(s: FollowUpState, nowMs: number): string | null {
  if (!s.lastAt) return null
  return `Follow-up sent ${daysAgo(s.lastAt, nowMs)} by ${s.lastBy ?? 'staff'}`
}

/** Split a list into its two tabs. */
export function splitFollowUpTabs<T extends { id: string }>(
  rows: T[],
  states: Map<string, FollowUpState>,
): { stuck: T[]; sent: T[] } {
  const stuck: T[] = []
  const sent: T[] = []
  for (const r of rows) (states.get(r.id)?.sent ? sent : stuck).push(r)
  return { stuck, sent }
}

/** Fill {placeholders}. Unknown ones are left so a test can catch them. */
export function fillTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m))
}

/** Any {placeholder} still in the text. */
export function unfilledPlaceholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
}

/** The WhatsApp text: the template with every placeholder filled, the
 *  continue link on its own line after it (or in place of {link}). */
export function followUpText(templateBody: string, v: { name: string; step: string | null; link: string }): string {
  const vars = {
    name: v.name,
    first_name: v.name,
    step: v.step ?? 'your profile',
    stopped_at: v.step ?? 'your profile',
    link: v.link,
    continue_link: v.link,
  }
  const hasLink = /\{(link|continue_link)\}/.test(templateBody)
  const filled = fillTemplate(templateBody.trim(), vars)
  return hasLink ? filled : `${filled}\n\n${v.link}`
}

/** https://wa.me/92XXXXXXXXXX?text=… — msisdn already in 92… form. */
export function followUpWaLink(msisdn: string, text: string): string {
  return `https://wa.me/${msisdn}?text=${encodeURIComponent(text)}`
}
