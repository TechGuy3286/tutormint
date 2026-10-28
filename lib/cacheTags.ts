// lib/cacheTags.ts — the data-cache tags public pages use (owner, 28 Oct 2026).
//
// PURE. A cached read on a public page carries a tag; the code that changes the
// data clears the tag, so the page shows the change on its next request instead
// of after its revalidate time.
//
//   TUITION_TAG   anything read about one or more tuitions (the "is this a repeat?"
//                 check behind a tuition page's canonical and JobPosting). Cleared by
//                 revalidateTuitions(), which every tuition post / edit / pause /
//                 resume / refresh / close / hire / merge reaches through the
//                 Indexing API helpers (lib/googleIndexing queueIndexingUpdate and
//                 queueIndexingForStatus).

export const TUITION_TAG = 'tuitions'
/** How long a cached tuition read may live with no change at all. */
export const TUITION_REVALIDATE = 300
