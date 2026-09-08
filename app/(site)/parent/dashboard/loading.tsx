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

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-3 px-4 py-6 sm:px-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-24 animate-pulse rounded-2xl bg-white ring-1 ring-gray-200" />
      <div className="h-16 animate-pulse rounded-2xl bg-white ring-1 ring-gray-200" />
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="h-14 animate-pulse rounded-2xl bg-white ring-1 ring-gray-200" />
        <div className="h-14 animate-pulse rounded-2xl bg-white ring-1 ring-gray-200" />
        <div className="h-14 animate-pulse rounded-2xl bg-white ring-1 ring-gray-200" />
        <div className="h-14 animate-pulse rounded-2xl bg-white ring-1 ring-gray-200" />
      </div>
    </div>
  )
}
