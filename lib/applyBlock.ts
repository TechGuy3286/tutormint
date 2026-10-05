// lib/applyBlock.ts
//
// WHY Apply is inactive (owner, 5 Oct 2026). Wherever the Apply button is
// disabled — Browse cards, the tuition page, the dashboard lists — one small
// line under it gives the actual reason. The decision is this ONE pure
// function, so the card, the page and the API windows cannot disagree, and the
// order is fixed: when several reasons apply only the FIRST shows.
//
//   1. applied   — "You applied on <date>"
//   2. quota     — "You've used all <N> for this month" + Upgrade (the sheet)
//   3. doc       — a staff rejection paused the badge: re-upload to apply again
//   4. closed    — the tuition is paused / closed / hired
//
// The SERVER still enforces every rule (/api/applications re-checks all of
// them); this only explains the disabled button. Pure, client-safe.

export type ApplyBlock =
  | { kind: 'applied'; appliedAt: string | null }
  | { kind: 'quota'; quota: number; unlimited: boolean }
  | { kind: 'doc'; href: string }
  | { kind: 'closed' }

export type ApplyBlockFacts = {
  /** When this tutor applied to THIS job (ISO), or null/undefined if never. */
  appliedAt?: string | null
  /** Already applied but the date is unknown (older callers) — still "applied". */
  applied?: boolean
  /** The viewer is on a plan (fee paid) — quota only applies then. */
  hasPlan: boolean
  quotaLeft: number
  quota: number
  /** The plan advertises "Unlimited" — never surface the real cap then. */
  unlimitedDisplay: boolean
  docRejected: boolean
  reuploadHref?: string | null
  jobStatus: string | null | undefined
}

export function applyBlockFor(f: ApplyBlockFacts): ApplyBlock | null {
  if (f.appliedAt || f.applied) return { kind: 'applied', appliedAt: f.appliedAt ?? null }
  if (f.hasPlan && f.quotaLeft <= 0) return { kind: 'quota', quota: f.quota, unlimited: f.unlimitedDisplay }
  if (f.docRejected) return { kind: 'doc', href: f.reuploadHref || '/tutor/dashboard/settings#identity' }
  if (f.jobStatus && f.jobStatus !== 'open') return { kind: 'closed' }
  return null
}
