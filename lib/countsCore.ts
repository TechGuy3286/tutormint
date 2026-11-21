// lib/countsCore.ts — ONE definition of every shared admin count (owner, 21 Nov
// 2026 — PR-14: "a count must be the same on every screen that shows it").
//
// PURE: the rules, the windows and the arithmetic. lib/counts.ts loads the
// facts; the Overview cards, Insights, the daily sign-up funnel and Paid
// sign-ups all count through here, and `npm run check:counts` recomputes every
// count from each screen's own data path and fails when two disagree.
//
// TIME. Pakistan time (UTC+5, no DST) for every window — lib/overviewTrendCore
// trendWindows, the one helper:
//   today      00:00 today → now
//   yesterday  the whole of yesterday
//   last7      00:00 six days ago → now (today and the six full days before)
//   month      the 1st of this month → now
//
// WHO COUNTS.
//   Member counts (sign-ups, mobile verified, onboarding, paid, active users,
//   funnels): the People rule, lib/peopleDirectoryCore excludedReason — staff,
//   seed, team, test-named, hidden (test), merged, erased and erase-requested
//   accounts are out, and so is a staff-linked account without real activity.
//   Staff ACTIONS (the actor rule, `actorCounts`): where the action itself is
//   what is counted — tuitions posted (staff post through the team account),
//   applications forwarded, WhatsApp updates sent — staff and the team account
//   count; seed, test, hidden, merged, erased and erase-requested accounts never
//   do. Burst-held parents' ACTIVITY stays out of Insights activity (labelled
//   there); their sign-up still counts.

import { DAY_MS, trendWindows, type Windows } from '@/lib/overviewTrendCore'
import type { ExcludeReason } from '@/lib/peopleDirectoryCore'

export { DAY_MS }

export type CountPeriod = 'today' | 'yesterday' | 'last7' | 'month'
export const COUNT_PERIODS: { key: CountPeriod; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'month', label: 'This month' },
]

export type Span = { start: number; end: number }

/** The four windows, Pakistan time. */
export function countWindows(nowMs: number): Windows {
  return trendWindows(nowMs)
}

/** One window by key. */
export function countSpan(period: CountPeriod, nowMs: number): Span {
  return countWindows(nowMs)[period]
}

/** The Pakistan days (YYYY-MM-DD) a window covers, oldest first. */
export function spanDays(span: Span): string[] {
  const out: string[] = []
  const PK = 5 * 3600_000
  for (let t = span.start; t < span.end; t += DAY_MS) out.push(new Date(t + PK).toISOString().slice(0, 10))
  return out
}

/** The span of one Pakistan day. */
export function daySpan(day: string): Span {
  const start = Date.parse(`${day}T00:00:00+05:00`)
  return { start, end: start + DAY_MS }
}

export function inSpan(at: string | number | null | undefined, span: Span): boolean {
  const t = typeof at === 'number' ? at : Date.parse(at ?? '')
  return Number.isFinite(t) && t >= span.start && t < span.end
}

// ------------------------------------------------------------ who counts ---

/** Member counts: the People rule (no exclusion reason). */
export function memberCounts(excluded: ExcludeReason | null | undefined): boolean {
  return excluded == null
}

/** Staff actions: staff and the team account count; seed, test, hidden,
 *  merged, erased and erase-requested accounts never do. An account that is not
 *  a member (a staff profile) counts. */
export function actorCounts(excluded: ExcludeReason | null | undefined): boolean {
  return excluded == null || excluded === 'staff' || excluded === 'team'
}

// ------------------------------------------------------------ the counts ---

export type CountKey =
  | 'tutor_signups'
  | 'parent_signups'
  | 'signups'
  | 'mobile_verified'
  | 'tutor_mobile_verified'
  | 'tutor_onboarded'
  | 'documents_uploaded'
  | 'paid_fee'
  | 'paid_plan'
  | 'tuitions_posted'
  | 'applications'
  | 'forwarded'
  | 'contact_viewed'

export type CountDef = { key: CountKey; label: string; what: string; who: 'members' | 'actors' }

/** The catalogue: the label a screen must use for each count, and what it is. */
export const COUNT_DEFS: Record<CountKey, CountDef> = {
  tutor_signups: { key: 'tutor_signups', label: 'New tutors', what: 'Tutor accounts created in the window (People rule).', who: 'members' },
  parent_signups: { key: 'parent_signups', label: 'New parents', what: 'Parent and institution accounts created in the window (People rule).', who: 'members' },
  signups: { key: 'signups', label: 'New sign-ups', what: 'New tutors + new parents — each account once, never the sign-up event (mobile sign-ups wrote it twice).', who: 'members' },
  mobile_verified: { key: 'mobile_verified', label: 'Mobile verified', what: 'Tutors and parents whose mobile was verified in the window (each once).', who: 'members' },
  tutor_mobile_verified: { key: 'tutor_mobile_verified', label: 'Tutors verified mobile', what: 'Tutors whose mobile was verified in the window.', who: 'members' },
  tutor_onboarded: { key: 'tutor_onboarded', label: 'Tutors finished onboarding', what: 'Tutors who finished onboarding in the window.', who: 'members' },
  documents_uploaded: { key: 'documents_uploaded', label: 'Document uploads', what: 'Documents uploaded by members in the window (each upload).', who: 'members' },
  paid_fee: { key: 'paid_fee', label: 'Paid', what: 'Tutors whose first Verification Fee was approved in the window, not refunded (each once).', who: 'members' },
  paid_plan: { key: 'paid_plan', label: 'Plans bought', what: 'Approved, not refunded plan payments (Premium, Featured, parent Featured) approved in the window.', who: 'members' },
  tuitions_posted: { key: 'tuitions_posted', label: 'Tuitions posted', what: 'Tuitions created in the window, whatever their status now — staff posts included.', who: 'actors' },
  applications: { key: 'applications', label: 'Applications', what: 'Applications made in the window by counted tutors.', who: 'members' },
  forwarded: { key: 'forwarded', label: 'Applications forwarded', what: 'Applications moved to Forwarded in the window (staff action), counted tutors.', who: 'actors' },
  contact_viewed: { key: 'contact_viewed', label: 'Contact number viewed', what: 'Tutor contact numbers revealed in the window, counted tutors.', who: 'members' },
}
export const COUNT_KEYS = Object.keys(COUNT_DEFS) as CountKey[]

/** What lib/counts loads: one row per counted thing, already filtered by its rule. */
export type CountFacts = {
  /** Every member with its People exclusion reason (counted or not). */
  members: { id: string; role: 'tutor' | 'parent'; createdAt: string; phoneVerifiedAt: string | null; onboardedAt: string | null; excluded: ExcludeReason | null }[]
  /** One per tutor: their first approved, not refunded Verification Fee. */
  feePaid: { memberId: string; at: string }[]
  plans: { id: string; memberId: string; at: string }[]
  jobs: { id: string; posterId: string | null; createdAt: string }[]
  applications: { id: string; tutorId: string; createdAt: string }[]
  forwards: { id: string; tutorId: string; createdAt: string }[]
  uploads: { id: string; memberId: string; createdAt: string }[]
  reveals: { tutorId: string; createdAt: string }[]
}

export type CountRow = { id: string; memberId: string | null; at: string }

/** The rows behind one count in a span — the drill-down list and the number. */
export function countRows(key: CountKey, f: CountFacts, span: Span): CountRow[] {
  const ex = new Map(f.members.map((m) => [m.id, m.excluded]))
  const isMember = (id: string | null) => !!id && ex.has(id) && memberCounts(ex.get(id))
  const isActor = (id: string | null) => !id || !ex.has(id) || actorCounts(ex.get(id))
  const counted = f.members.filter((m) => memberCounts(m.excluded))
  switch (key) {
    case 'tutor_signups':
    case 'parent_signups':
    case 'signups': {
      const role = key === 'tutor_signups' ? 'tutor' : key === 'parent_signups' ? 'parent' : null
      return counted.filter((m) => (!role || m.role === role) && inSpan(m.createdAt, span)).map((m) => ({ id: m.id, memberId: m.id, at: m.createdAt }))
    }
    case 'mobile_verified':
    case 'tutor_mobile_verified':
      return counted
        .filter((m) => (key === 'mobile_verified' || m.role === 'tutor') && inSpan(m.phoneVerifiedAt, span))
        .map((m) => ({ id: m.id, memberId: m.id, at: m.phoneVerifiedAt as string }))
    case 'tutor_onboarded':
      return counted.filter((m) => m.role === 'tutor' && inSpan(m.onboardedAt, span)).map((m) => ({ id: m.id, memberId: m.id, at: m.onboardedAt as string }))
    case 'documents_uploaded':
      return f.uploads.filter((u) => isMember(u.memberId) && inSpan(u.createdAt, span)).map((u) => ({ id: u.id, memberId: u.memberId, at: u.createdAt }))
    case 'paid_fee':
      return f.feePaid.filter((p) => isMember(p.memberId) && inSpan(p.at, span)).map((p) => ({ id: p.memberId, memberId: p.memberId, at: p.at }))
    case 'paid_plan':
      return f.plans.filter((p) => isMember(p.memberId) && inSpan(p.at, span)).map((p) => ({ id: p.id, memberId: p.memberId, at: p.at }))
    case 'tuitions_posted':
      return f.jobs.filter((j) => isActor(j.posterId) && inSpan(j.createdAt, span)).map((j) => ({ id: j.id, memberId: j.posterId, at: j.createdAt }))
    case 'applications':
      return f.applications.filter((a) => isMember(a.tutorId) && inSpan(a.createdAt, span)).map((a) => ({ id: a.id, memberId: a.tutorId, at: a.createdAt }))
    case 'forwarded':
      return f.forwards.filter((a) => isMember(a.tutorId) && inSpan(a.createdAt, span)).map((a) => ({ id: a.id, memberId: a.tutorId, at: a.createdAt }))
    case 'contact_viewed':
      return f.reveals.filter((r) => isMember(r.tutorId) && inSpan(r.createdAt, span)).map((r, i) => ({ id: `${r.tutorId}:${r.createdAt}:${i}`, memberId: r.tutorId, at: r.createdAt }))
  }
}

export function countOne(key: CountKey, f: CountFacts, span: Span): number {
  return countRows(key, f, span).length
}

export function countAll(f: CountFacts, span: Span): Record<CountKey, number> {
  return Object.fromEntries(COUNT_KEYS.map((k) => [k, countOne(k, f, span)])) as Record<CountKey, number>
}

/** The first approved, not refunded Verification Fee per tutor — the one
 *  "Paid" rule (each tutor once, on that payment's approval time). */
export function firstFeePayments(rows: { userId: string | null; approvedAt: string | null; refunded: boolean }[]): { memberId: string; at: string }[] {
  const first = new Map<string, string>()
  for (const r of rows) {
    if (!r.userId || !r.approvedAt || r.refunded) continue
    const cur = first.get(r.userId)
    if (!cur || r.approvedAt < cur) first.set(r.userId, r.approvedAt)
  }
  return [...first].map(([memberId, at]) => ({ memberId, at })).sort((a, b) => a.at.localeCompare(b.at))
}

// ------------------------------------------------------- check:counts ------

export type CountSource = { screen: string; values: Partial<Record<CountKey, number>> }
export type CountMismatch = { key: CountKey; values: { screen: string; value: number }[] }

/** Every count two or more sources show, where they do not all agree. */
export function compareSources(sources: readonly CountSource[]): CountMismatch[] {
  const out: CountMismatch[] = []
  for (const key of COUNT_KEYS) {
    const vals = sources.filter((s) => s.values[key] !== undefined).map((s) => ({ screen: s.screen, value: s.values[key] as number }))
    if (vals.length > 1 && new Set(vals.map((v) => v.value)).size > 1) out.push({ key, values: vals })
  }
  return out
}
