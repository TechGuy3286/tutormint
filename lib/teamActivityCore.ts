// lib/teamActivityCore.ts
//
// PURE, client-safe. Tuitions → Team activity (owner, 15 Oct 2026): ONE page
// that replaced "Tuition posting activity" and "Staff activity". Two tabs:
//
//   paid    Paid sign-ups (default). Paid tutor sign-ups per staff member —
//           the number staff are paid for — then a separate "In progress (not
//           counted)" block and Parents (for information). Everyone on
//           tuitionPosting opens it; Operations and Tuitions staff see their
//           own row only (lib/staffSignupsCore seesEveryone).
//   posted  Tuitions posted. Everyone's rows, for every role on the page.
//
// The third tab, "Verifications & messages", was REMOVED (owner, 15 Oct 2026,
// later the same day): approvals are now the Owner's alone, and approvals and
// messages stay recorded in Audit. Its old links land on Paid sign-ups
// (isRemovedTab); its API answers 404.
//
// Who sees which tab is decided HERE and read by the page, the API and the
// tests, so they cannot disagree.

import { roleSatisfies, SCREEN_ACCESS, type AdminRole } from './adminAccessCore'

export const TEAM_ACTIVITY_PATH = '/admin/team-activity'

export type TeamTab = 'paid' | 'posted'

export const TEAM_TABS: { key: TeamTab; label: string }[] = [
  { key: 'paid', label: 'Paid sign-ups' },
  { key: 'posted', label: 'Tuitions posted' },
]

export const DEFAULT_TAB: TeamTab = 'paid'

/** The tab that used to exist; a link to it lands on the default tab. */
export const REMOVED_TABS = ['verifications'] as const

export function isRemovedTab(v: string | null | undefined): boolean {
  return (REMOVED_TABS as readonly string[]).includes(v ?? '')
}

/** May this role open this tab? */
export function mayOpenTab(role: AdminRole | null | undefined, tab: TeamTab): boolean {
  if (!role) return false
  void tab
  return roleSatisfies(role, SCREEN_ACCESS.tuitionPosting)
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

/** /admin/staff-activity → Paid sign-ups (its Verifications tab was removed). */
export function staffActivityRedirect(): string {
  return teamActivityHref('paid')
}

/** Keep the query string of a moved page. */
export function withQuery(path: string, sp: Query): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    const val = one(v)
    if (val != null) q.set(k, val)
  }
  const s = q.toString()
  return s ? `${path}?${s}` : path
}
