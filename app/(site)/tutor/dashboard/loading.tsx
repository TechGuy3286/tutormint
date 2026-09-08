// A loading boundary for the tutor dashboard subtree. Same two jobs as the
// parent dashboard's (see that file): a streaming skeleton so a starved RSC
// fetch never leaves an empty body under the shell, and a `loading.js` boundary
// so a dynamic-route prefetch is PARTIAL rather than the whole page — which is
// what stops the dashboard/footer links exhausting the browser connection pool.

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-3 px-4 py-6 sm:px-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-24 animate-pulse rounded-2xl bg-white ring-1 ring-gray-200" />
      <div className="h-20 animate-pulse rounded-2xl bg-white ring-1 ring-gray-200" />
      <div className="h-16 animate-pulse rounded-2xl bg-white ring-1 ring-gray-200" />
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="h-14 animate-pulse rounded-2xl bg-white ring-1 ring-gray-200" />
        <div className="h-14 animate-pulse rounded-2xl bg-white ring-1 ring-gray-200" />
      </div>
    </div>
  )
}
