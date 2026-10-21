// lib/followUpsPageCore.ts
//
// PURE, client-safe. People → Follow-ups (owner, 15 Oct 2026): ONE page in place
// of "Unpaid signups" and "Abandoned signups". Three tabs:
//
//   tutors   Tutors — the Unpaid signups list (tutors who joined in the last
//            30 days and have not paid), with "Stopped at", "Still to do" and
//            the WhatsApp / Call follow-up actions. SCREEN_ACCESS.unpaidSignups
//            (Owner, Project Managers, Admin, Operations, Tuitions staff).
//   parents  Parents & email not confirmed — from Abandoned signups: parents
//            who have not finished, and any email signup never confirmed.
//            SCREEN_ACCESS.signups (not Tuitions staff).
//   orphans  Orphaned accounts — a sign-in with no profile row. SCREEN_ACCESS.signups.
//
// Tutors who have not finished are on the Tutors tab only, so nobody is on two
// tabs. Old addresses redirect here with their query string kept.

import { roleSatisfies, SCREEN_ACCESS, type AdminRole } from './adminAccessCore'

export const FOLLOW_UPS_PATH = '/admin/follow-ups'

export type FollowUpTab = 'tutors' | 'parents' | 'orphans'

export const FOLLOW_UP_TABS: { key: FollowUpTab; label: string }[] = [
  { key: 'tutors', label: 'Tutors' },
  { key: 'parents', label: 'Parents & email not confirmed' },
  { key: 'orphans', label: 'Orphaned accounts' },
]

export function mayOpenFollowUpTab(role: AdminRole | null | undefined, tab: FollowUpTab): boolean {
  if (!role) return false
  return roleSatisfies(role, tab === 'tutors' ? SCREEN_ACCESS.unpaidSignups : SCREEN_ACCESS.signups)
}

export function followUpTabsFor(role: AdminRole | null | undefined): FollowUpTab[] {
  return FOLLOW_UP_TABS.map((t) => t.key).filter((k) => mayOpenFollowUpTab(role, k))
}

/** Unknown or not-allowed → the first tab this role may open (Tutors for everyone today). */
export function pickFollowUpTab(role: AdminRole | null | undefined, requested: string | null | undefined): FollowUpTab {
  const tabs = followUpTabsFor(role)
  return tabs.includes(requested as FollowUpTab) ? (requested as FollowUpTab) : (tabs[0] ?? 'tutors')
}

type Query = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/** A Follow-ups address for a tab, keeping any extra query (filter=today…). */
export function followUpsHref(tab: FollowUpTab, extra: Query = {}): string {
  const q = new URLSearchParams()
  if (tab !== 'tutors') q.set('tab', tab)
  for (const [k, v] of Object.entries(extra)) {
    const val = one(v)
    if (val != null && val !== '' && k !== 'tab') q.set(k, val)
  }
  const s = q.toString()
  return s ? `${FOLLOW_UPS_PATH}?${s}` : FOLLOW_UPS_PATH
}

/** Is this Abandoned-signups row for the Parents tab? Every unfinished tutor —
 *  an unconfirmed email included — is on the Tutors tab (owner, 21 Oct 2026);
 *  a parent who has not finished or never confirmed their email is here. */
export function onParentsTab(row: { stage: string; role: string | null }): boolean {
  return row.role !== 'tutor'
}
