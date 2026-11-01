import { invalidateMemoTag } from '@/lib/memoCache'
import 'server-only'
import { LANDING_TAG } from '@/lib/landing'
import { TUITION_TAG } from '@/lib/cacheTags'
import { revalidatePublicTutors } from '@/lib/publicRevalidate'

// On-demand revalidation for the landing pages.
//
// The landing combination set (which pages exist, their counts, the sitemap
// entries, the link-helper decisions) is cached under one tag. This marks that
// tag stale so the next request rebuilds it — called when a listing changes in
// a way that could open or close a page: a tutor is listed or unlisted, a
// tuition opens or closes.
//
// It is a mark, not a rebuild, so it is cheap and safe to over-call. Wrapped in
// try/catch because revalidateTag only works inside a request scope: the same
// mutation helpers also run from scripts and the cron, where there is nothing
// to revalidate and the call would otherwise throw.
export function revalidateLanding(opts: { tutors?: boolean } = {}): void {
  try {
    // profile 'max': mark stale with stale-while-revalidate, the form this
    // Next version recommends over the deprecated single-argument call — a
    // brief delay before a landing page reflects a new listing is fine.
    invalidateMemoTag(LANDING_TAG)
  } catch {
    /* not in a request scope (script/cron) — nothing to revalidate */
  }
  // The cached tutor pages too (push 3, owner 1 Nov 2026) — unless only a
  // tuition changed, which no tutor page shows.
  if (opts.tutors !== false) revalidatePublicTutors()
}

/** Clear every cached tuition read (owner, 28 Oct 2026 — lib/cacheTags). Same
 *  try/catch reason as above: scripts and crons outside a request scope. */
export function revalidateTuitions(): void {
  try {
    invalidateMemoTag(TUITION_TAG)
  } catch {
    /* not in a request scope — nothing to revalidate */
  }
}
