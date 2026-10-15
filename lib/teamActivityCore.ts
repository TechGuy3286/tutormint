// lib/teamActivityCore.ts
//
// PURE, client-safe. Tuitions → Team activity (owner, 15 Oct 2026): ONE page
// that replaced "Tuition posting activity" and "Staff activity", which showed
// overlapping numbers. Three tabs:
//
//   paid           Paid sign-ups (default). Paid tutor sign-ups per staff member
//                  — the number staff are paid for — then a separate "In
//                  progress (not counted)" block and Parents (for information).
//                  Everyone on tuitionPosting opens it; Operations and Tuitions
//                  staff see their own row only (lib/staffSignupsCore seesEveryone).
//   posted         Tuitions posted. Everyone's rows, for every role on the page.
//   verifications  Verifications & messages. Owner, Project Managers and Admin
//                  only (SCREEN_ACCESS.staffActivity); 403 on the API otherwise.
//
// Who sees which tab is decided HERE and read by the page, the API and the
// tests, so they cannot disagree.

import { roleSatisfies, SCREEN_ACCESS, type AdminRole } from './adminAccessCore'
import type { StaffCounts } from './staffActivityCore'

export const TEAM_ACTIVITY_PATH = '/admin/team-activity'

export type TeamTab = 'paid' | 'posted' | 'verifications'

export const TEAM_TABS: { key: TeamTab; label: string }[] = [
  { key: 'paid', label: 'Paid sign-ups' },
  { key: 'posted', label: 'Tuitions posted' },
  { key: 'verifications', label: 'Verifications & messages' },
]

export const DEFAULT_TAB: TeamTab = 'paid'

/** May this role open this tab? */
export function mayOpenTab(role: AdminRole | null | undefined, tab: TeamTab): boolean {
  if (!role) return false
  if (!roleSatisfies(role, SCREEN_ACCESS.tuitionPosting)) return false
  if (tab === 'verifications') return roleSatisfies(role, SCREEN_ACCESS.staffActivity)
  return true
}

/** The tabs this role sees, in order. Empty = the page is not theirs. */
export function tabsFor(role: AdminRole | null | undefined): TeamTab[] {
  return TEAM_TABS.map((t) => t.key).filter((k) => mayOpenTab(role, k))
}

export function isTeamTab(v: string | null | undefined): v is TeamTab {
  return TEAM_TABS.some((t) => t.key === v)
}

/** The tab to render for a requested value: unknown or not allowed → default. */
export function pickTab(role: AdminRole | null | undefined, requested: string | null | undefined): TeamTab {
  return isTeamTab(requested) && mayOpenTab(role, requested) ? requested : DEFAULT_TAB
}

export function teamActivityHref(tab: TeamTab = DEFAULT_TAB, extra: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams()
  if (tab !== DEFAULT_TAB) q.set('tab', tab)
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v)
  const s = q.toString()
  return s ? `${TEAM_ACTIVITY_PATH}?${s}` : TEAM_ACTIVITY_PATH
}

// ------------------------------------------------------- old addresses

type Query = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/** /admin/jobs/posting-activity[?tab=signups&period=…] → the matching tab. */
export function postingActivityRedirect(sp: Query): string {
  return one(sp.tab) === 'signups' ? teamActivityHref('paid', { period: one(sp.period) }) : teamActivityHref('posted')
}

/** /admin/staff-activity → the Verifications & messages tab. */
export function staffActivityRedirect(): string {
  return teamActivityHref('verifications')
}

/** Keep the query string of a moved sub-page (list, claims, staff detail). */
export function withQuery(path: string, sp: Query): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    const val = one(v)
    if (val != null) q.set(k, val)
  }
  const s = q.toString()
  return s ? `${path}?${s}` : path
}

// ------------------------------------------- Verifications & messages tab

export type VerificationCounts = {
  approved: { today: number; week: number; total: number }
  rejected: { today: number; week: number; total: number }
  messages: { today: number; week: number; total: number }
}

export type VerificationRow = { id: string; name: string; counts: VerificationCounts }

export function verificationCounts(c: StaffCounts): VerificationCounts {
  return { approved: { ...c.approved }, rejected: { ...c.rejected }, messages: { ...c.messages } }
}

const emptyWindow = () => ({ today: 0, week: 0, total: 0 })

export function verificationTotal(rows: VerificationRow[]): VerificationRow {
  const counts: VerificationCounts = { approved: emptyWindow(), rejected: emptyWindow(), messages: emptyWindow() }
  for (const r of rows) {
    for (const k of ['approved', 'rejected', 'messages'] as const) {
      counts[k].today += r.counts[k].today
      counts[k].week += r.counts[k].week
      counts[k].total += r.counts[k].total
    }
  }
  return { id: 'team', name: 'Team total', counts }
}

const activity = (r: VerificationRow, w: 'today' | 'week' | 'total') =>
  r.counts.approved[w] + r.counts.rejected[w] + r.counts.messages[w]

/** Most active today first, then this week, then all time, then by name. */
export function sortVerificationRows(rows: VerificationRow[]): VerificationRow[] {
  return [...rows].sort(
    (a, b) =>
      activity(b, 'today') - activity(a, 'today') ||
      activity(b, 'week') - activity(a, 'week') ||
      activity(b, 'total') - activity(a, 'total') ||
      a.name.localeCompare(b.name),
  )
}
