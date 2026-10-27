// lib/hiddenTuitionCore.ts
//
// PURE rules for the tuitions of a hidden parent (owner, 24 Oct 2026).
//
// When a parent account is hidden, marked as a test account, suspended or
// banned, every tuition they posted gets status 'hidden' (migration 198 keeps
// this in step with the account by a trigger; un-hiding restores each
// tuition's own status). A hidden tuition:
//   • is in no public list — every public reader lists open tuitions only, and
//     the sitemap functions read status;
//   • has no JobPosting and is noindex (it never renders: its address 301s);
//   • 301-redirects to its city's public tuition page (/tuition-jobs/<city>),
//     or to Browse tuitions when that city has no open tuition (the city page
//     is a 404 then);
//   • keeps its applications, which read "Tuition no longer available" and
//     leave To do, the Paid tutors red rules and every badge.
// Nothing is deleted.

import { citySegment } from '@/lib/slugs'

export const HIDDEN_STATUS = 'hidden'

/** Why the parent's tuitions are hidden (jobs.hidden_reason). */
export type HiddenReason = 'parent_banned' | 'parent_suspended' | 'parent_hidden' | 'parent_test'

export const HIDDEN_REASON_WORDS: Record<HiddenReason, string> = {
  parent_banned: 'Parent account banned',
  parent_suspended: 'Parent account suspended',
  parent_hidden: 'Parent account hidden',
  parent_test: 'Parent is a test account',
}

/** The words a tutor and staff see on an application to a hidden tuition. */
export const NO_LONGER_AVAILABLE = 'Tuition no longer available'
/** The tutor dashboard line in place of a stage. */
export const NO_LONGER_AVAILABLE_TUTOR = 'This tuition is no longer available'

export function isHiddenTuition(status: string | null | undefined): boolean {
  return status === HIDDEN_STATUS
}

/** The mirror of SQL parent_hide_reason(): the poster flags that hide tuitions. */
export function parentHideReason(p: {
  is_banned?: boolean | null
  is_suspended?: boolean | null
  hidden_from_public?: boolean | null
  is_test_name?: boolean | null
}): HiddenReason | null {
  if (p.is_banned) return 'parent_banned'
  if (p.is_suspended) return 'parent_suspended'
  if (p.hidden_from_public) return 'parent_hidden'
  if (p.is_test_name) return 'parent_test'
  return null
}

/** Where a hidden tuition's address goes: its city's public tuition page when
 *  that city still has an open tuition, else Browse tuitions. */
export function hiddenTuitionTarget(city: string | null | undefined, cityHasOpen: boolean): string {
  const c = (city ?? '').trim()
  if (c && cityHasOpen) return `/tuition-jobs/${citySegment(c)}`
  return '/browse/tuitions'
}

/** /tuitions/<city>/<slug> → the slug, else null (landing pages share the
 *  route; their second segment is never a hidden tuition's public slug). */
const TUITION_PATH = /^\/tuitions\/[^/]+\/([^/]+)\/?$/
export function tuitionSlugOf(pathname: string): string | null {
  const m = TUITION_PATH.exec(pathname)
  if (!m) return null
  try {
    return decodeURIComponent(m[1]).toLowerCase()
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// A parent's public card (/parent/[id]) — the ONE rule for whether it renders,
// read by lib/publicParent (the page) and by every link to it (job cards, the
// tuition page). A link is drawn only when the card resolves, so no live page
// links to a 404.

export function parentCardResolves(p: {
  role?: string | null
  is_suspended?: boolean | null
  is_banned?: boolean | null
  hidden_from_public?: boolean | null
} | null | undefined): boolean {
  if (!p) return false
  if (p.role !== 'parent' && p.role !== 'academy') return false
  if (p.is_suspended || p.is_banned || p.hidden_from_public) return false
  return true
}

/** A staff action refused on an application to a hidden tuition. */
export const NO_LONGER_AVAILABLE_STAFF = 'Tuition no longer available. It is hidden or its contact was withdrawn.'
