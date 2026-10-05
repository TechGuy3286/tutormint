import { TileSkeletons } from '@/components/Skeletons'

// A loading boundary for the parent dashboard subtree.
//
// TWO JOBS (fix: prefetch storm, 9 Sep). First, resilience: on a soft
// navigation the body streams in behind this skeleton, so a slow or starved
// RSC fetch shows a loading state rather than leaving an empty body under the
// header/footer shell. Second — and the reason it exists on every dashboard —
// a `loading.js` boundary makes a DYNAMIC route's prefetch PARTIAL: Next
// prefetches only down to this boundary instead of the whole page, so the
// dozens of dashboard/footer links no longer each request a full RSC payload
// and exhaust the browser's connection pool.
//
// #102/#103: shaped like the dashboard — the header card, then the square
// tiles — with no "Loading…" text anywhere.

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-3 px-4 py-6 sm:px-6" role="status" aria-busy="true" aria-label="Please wait">
      <div className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4">
        <span aria-hidden className="h-16 w-16 shrink-0 animate-pulse rounded-full bg-gray-200" />
        <div className="flex-1 space-y-2">
          <span aria-hidden className="block h-4 w-2/5 animate-pulse rounded-md bg-gray-200" />
          <span aria-hidden className="block h-3 w-1/4 animate-pulse rounded-md bg-gray-200" />
        </div>
      </div>
      <TileSkeletons count={6} />
    </div>
  )
}
