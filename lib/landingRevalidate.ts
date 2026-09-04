import 'server-only'
import { revalidateTag } from 'next/cache'
import { LANDING_TAG } from '@/lib/landing'

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
export function revalidateLanding(): void {
  try {
    // profile 'max': mark stale with stale-while-revalidate, the form this
    // Next version recommends over the deprecated single-argument call — a
    // brief delay before a landing page reflects a new listing is fine.
    revalidateTag(LANDING_TAG, 'max')
  } catch {
    /* not in a request scope (script/cron) — nothing to revalidate */
  }
}
