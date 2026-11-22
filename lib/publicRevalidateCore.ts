// PURE. Which cached public pages a change marks for rebuild (PR-15).
//
// Public pages are ISR-cached with a long safety-net time limit (hours, not
// minutes — `PUBLIC_REVALIDATE`) and are rebuilt on demand only when their own
// content changes. Each trigger below returns the exact marks it needs, so the
// tests can check that a change rebuilds its pages and nothing else: every
// mark is a rewrite on the next visit, and the long-tail crawl visits almost
// every page, so an extra mark costs real ISR writes.

import { citySegment } from '@/lib/slugs'

export type Mark = { path: string; type?: 'page' | 'layout' }

/** The safety-net time limits, in seconds (each page's `export const
 *  revalidate` must be a literal, so test:pr15 checks the pages against these). */
export const PUBLIC_REVALIDATE = {
  /** Fixed-text pages: about, FAQ, terms, privacy, support, post-a-tuition (the
   *  locked homepage keeps its 1 h — already hours, and rebuilt on tuition changes). */
  static: 86_400,
  /** One tutor, one tuition, one blog post, and the long-tail hubs
   *  (city × subject, variants, school pages). */
  entity: 86_400,
  /** The main city hubs and the blog index. */
  hub: 21_600,
  /** /browse/tutors and /browse/tuitions (bare, signed-out copy). */
  browse: 3_600,
  /** The search-word list API. */
  api: 3_600,
} as const

/** A tuition changed (posted, edited, paused, resumed, refreshed, closed,
 *  hired, merged): its page, its city's hubs (all variants and areas), the
 *  school hubs, Browse tuitions and the homepage's "Newest tuitions". */
export function tuitionMarks(job: { public_slug?: string | null; city?: string | null }): Mark[] {
  const out: Mark[] = []
  if (job.public_slug) out.push({ path: `/tuitions/${citySegment(job.city)}/${job.public_slug}` })
  if (job.city) out.push({ path: `/tuition-jobs/${citySegment(job.city)}`, type: 'layout' })
  out.push({ path: '/tuition-jobs/school/[school]', type: 'page' })
  out.push({ path: '/browse/tuitions' })
  out.push({ path: '/' })
  return out
}

/** A listing changed (listed / unlisted, moderation, pause, merge, erase,
 *  conversion): the tutor landing pages and Browse tutors. NOT every tutor
 *  profile — the changed tutor's own profile is marked by its own event. A
 *  tutor who LEAVES the indexable set also rebuilds, at once, exactly the pages
 *  that linked to them (PR-16, lib/tutorLinkersCore). */
export function tutorListingMarks(): Mark[] {
  return [
    { path: '/tutors/[city]/[subject]', type: 'page' },
    { path: '/tutors/[city]', type: 'page' },
    { path: '/tutors/[city]/female', type: 'page' },
    { path: '/browse/tutors' },
  ]
}

/** A curated area or alias changed (Locations): the tuition hubs of every
 *  city (area hubs live under them). */
export function areaMarks(): Mark[] {
  return [{ path: '/tuition-jobs/[city]', type: 'layout' }]
}

/** One tutor's own profile. */
export function tutorProfileMarks(slug: string | null | undefined): Mark[] {
  return slug ? [{ path: `/tutor/${slug}` }] : []
}

/** The path of a full tutormint.org URL (the indexing queue stores URLs). */
export function pathOfUrl(url: string): string | null {
  try {
    return new URL(url).pathname
  } catch {
    return null
  }
}

/** Activity events that never change what a visitor sees on the member's
 *  public profile — they do not rebuild it (PR-15). Everything else does. */
export const PROFILE_NEUTRAL_EVENTS: ReadonlySet<string> = new Set([
  'login',
  'password_changed',
  'terms_accepted',
  'email_confirmed',
  'email_preferences_changed',
  'whatsapp_updates_changed',
  'follow_up_sent',
  'follow_up_undone',
  'job_posted',
  'job_edited',
  'job_closed',
  'seeded_contact_messaged',
  'application_submitted',
  'application_withdrawn',
  'application_stage_changed',
  'application_follow_up',
  'application_follow_up_undone',
  'demo_requested',
  'demo_accepted',
  'demo_declined',
  'demo_completed',
  'message_sent',
  'shortlist_added',
  'shortlist_removed',
  'profile_viewed',
  'search_performed',
  'blocked',
  'blocked_by',
  'unblocked',
  'reported',
  'reported_by',
  'payment_submitted',
  'payment_rejected',
  'checkout_cancelled',
  'admin_message_received',
  'warned',
  'report_resolved',
  'cv_downloaded',
  'cv_accent_changed',
  'saved_job_added',
  'saved_job_removed',
  'review_submitted',
  'review_rejected',
  'plan_expiring',
])

export function eventRebuildsProfile(event: string): boolean {
  return !PROFILE_NEUTRAL_EVENTS.has(event)
}
