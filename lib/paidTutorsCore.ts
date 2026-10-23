// lib/paidTutorsCore.ts
//
// PURE, client-safe. Tuitions → Paid tutors (owner, 23 Oct 2026): has every
// paid tutor been served? One row per paid tutor (the People → Tutors → Paid
// rule: the Verification Fee paid by any method, an Owner grant included; the
// People page's excluded accounts are left out).
//
// A row is RED when either:
//   • an application has waited MORE than 1 day to be forwarded — at
//     "Applied" and in no live forward. Exactly 1 day is not yet red. An
//     application on a tuition posted over 30 days ago never makes a row red
//     (the Applications "Older" rule); or
//   • the tutor has not been contacted for 7 days — the last message, call or
//     note to them was 7 or more days ago (never contacted: counted from the
//     day they paid). Exactly 7 days is red.
// Red rows sort first. "Profile not finished" shows when they paid but have
// not finished onboarding.
//
// The sidebar badge counts the red rows in the signed-in staff member's cities
// (the city owner of the tutor's city); the site Owner sees all of them.
//
// Unit-tested by scripts/test-tutor-journey.ts.

export const FORWARD_WAIT_DAYS = 1
export const NO_CONTACT_DAYS = 7
export const OLDER_TUITION_DAYS = 30
const DAY = 86_400_000

export type PaidApp = {
  jobId: string
  stage: string
  createdAt: string
  stageChangedAt: string | null
  jobCreatedAt: string | null
  forwarded: boolean
  /** The tuition was hidden with its parent's account (owner, 24 Oct 2026):
   *  never waiting to be forwarded, never a red rule. */
  unavailable?: boolean
}

export type PaidTutorFacts = {
  id: string
  name: string
  city: string | null
  paidAt: string
  apps: PaidApp[]
  lastContactAt: string | null
  profileFinished: boolean
  /** The city owner's staff id (null = no owner → the site Owner). */
  ownerId: string | null
}

export type RedReason = 'waiting_to_forward' | 'no_contact'

export const RED_LABEL: Record<RedReason, string> = {
  waiting_to_forward: 'Waiting to forward over 1 day',
  no_contact: 'Not contacted for 7 days',
}

const ms = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : NaN
}

export type PaidCounts = { applied: number; forwarded: number; waitingToForward: number; hired: number }

const SHARED = new Set(['forwarded', 'contacted', 'demo', 'hired', 'no_response'])

export function paidCounts(apps: PaidApp[]): PaidCounts {
  let forwarded = 0
  let waiting = 0
  let hired = 0
  for (const a of apps) {
    if (SHARED.has(a.stage) || (a.stage === 'applied' && a.forwarded)) forwarded++
    else if (a.stage === 'applied' && !a.unavailable) waiting++
    if (a.stage === 'hired') hired++
  }
  return { applied: apps.length, forwarded, waitingToForward: waiting, hired }
}

/** Waiting to be forwarded for MORE than 1 day (Older tuitions never count). */
export function forwardOverdue(a: PaidApp, nowMs: number): boolean {
  if (a.unavailable) return false
  if (a.stage !== 'applied' || a.forwarded) return false
  const job = ms(a.jobCreatedAt)
  if (Number.isFinite(job) && nowMs - job > OLDER_TUITION_DAYS * DAY) return false
  const since = ms(a.stageChangedAt) || ms(a.createdAt)
  return Number.isFinite(since) && nowMs - since > FORWARD_WAIT_DAYS * DAY
}

/** Not contacted for 7 days or more (never contacted: since they paid). */
export function noContact(f: Pick<PaidTutorFacts, 'lastContactAt' | 'paidAt'>, nowMs: number): boolean {
  const since = ms(f.lastContactAt) || ms(f.paidAt)
  return Number.isFinite(since) && nowMs - since >= NO_CONTACT_DAYS * DAY
}

export function redReasons(f: PaidTutorFacts, nowMs: number): RedReason[] {
  const out: RedReason[] = []
  if (f.apps.some((a) => forwardOverdue(a, nowMs))) out.push('waiting_to_forward')
  if (noContact(f, nowMs)) out.push('no_contact')
  return out
}

export type PaidRow = PaidTutorFacts & { counts: PaidCounts; red: RedReason[] }

export function toRow(f: PaidTutorFacts, nowMs: number): PaidRow {
  return { ...f, counts: paidCounts(f.apps), red: redReasons(f, nowMs) }
}

/** Red rows first, then the longest since contact, then name. */
export function sortRows(rows: PaidRow[]): PaidRow[] {
  return [...rows].sort((a, b) => {
    const r = Number(b.red.length > 0) - Number(a.red.length > 0)
    if (r) return r
    const ca = ms(a.lastContactAt) || ms(a.paidAt)
    const cb = ms(b.lastContactAt) || ms(b.paidAt)
    if (ca !== cb) return (Number.isFinite(ca) ? ca : 0) - (Number.isFinite(cb) ? cb : 0)
    return a.name.localeCompare(b.name)
  })
}

export const PAID_FILTERS = ['all', 'red', 'not_applied', 'hired'] as const
export type PaidFilter = (typeof PAID_FILTERS)[number]
export const PAID_FILTER_LABEL: Record<PaidFilter, string> = { all: 'All', red: 'Red only', not_applied: 'Not applied yet', hired: 'Hired' }

export function parsePaidFilter(v: string | null | undefined): PaidFilter {
  return (PAID_FILTERS as readonly string[]).includes(v ?? '') ? (v as PaidFilter) : 'all'
}

export function matchesPaidFilter(r: PaidRow, f: PaidFilter): boolean {
  if (f === 'red') return r.red.length > 0
  if (f === 'not_applied') return r.counts.applied === 0
  if (f === 'hired') return r.counts.hired > 0
  return true
}

/** 'all' or a staff id (the city owner); 'none' = cities with no owner. */
export function matchesStaff(r: Pick<PaidRow, 'ownerId'>, staff: string): boolean {
  if (staff === 'all') return true
  if (staff === 'none') return !r.ownerId
  return r.ownerId === staff
}

export function matchesSearch(r: Pick<PaidRow, 'name' | 'city'>, q: string): boolean {
  const n = q.trim().toLowerCase()
  if (!n) return true
  return [r.name, r.city].some((v) => (v ?? '').toLowerCase().includes(n))
}

/** The sidebar badge: red rows in this staff member's cities; every red row
 *  for the site Owner. */
export function paidBadgeCount(rows: Pick<PaidRow, 'red' | 'ownerId'>[], actor: { id: string; adminRole: string | null | undefined }): number {
  return rows.filter((r) => r.red.length > 0 && (actor.adminRole === 'owner' || r.ownerId === actor.id)).length
}

export function filterCounts(rows: PaidRow[]): Record<PaidFilter, number> {
  return {
    all: rows.length,
    red: rows.filter((r) => matchesPaidFilter(r, 'red')).length,
    not_applied: rows.filter((r) => matchesPaidFilter(r, 'not_applied')).length,
    hired: rows.filter((r) => matchesPaidFilter(r, 'hired')).length,
  }
}
