'use client'

import { useMemo } from 'react'
import JobCard, { type JobCardData } from '@/components/JobCard'
import { useInfinite } from '@/lib/useInfinite'

// Infinite scroll for a tuition landing page. Reuses /api/browse/tuitions and
// renders NO ads, for the same reason as MoreLandingTutors: a landing page is
// not a permitted ad placement.

type Row = JobCardData & { applied?: boolean }

export default function MoreLandingJobs({
  params,
  initialCursor,
}: {
  params: Record<string, string>
  initialCursor: string | null
}) {
  const storageKey = useMemo(
    () => `tm:landing:tuitions:${new URLSearchParams(params).toString()}`,
    [params],
  )
  const { items, state, done, loadMore, sentinel } = useInfinite<Row>({
    endpoint: '/api/browse/tuitions',
    params,
    initialCursor,
    storageKey,
  })

  return (
    <>
      {items.length > 0 && (
        <div className="space-y-4">
          {items.map((j) => (
            <JobCard key={j.id} job={j} signedIn={false} showApply={false} />
          ))}
        </div>
      )}

      <div ref={sentinel} aria-hidden className="h-px" />

      {!done && (
        <div className="flex justify-center py-4">
          <button
            type="button"
            onClick={loadMore}
            disabled={state === 'loading'}
            className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-5 text-xs font-bold text-tm-navy disabled:opacity-60"
          >
            {state === 'loading' ? 'Loading…' : 'Load more tuitions'}
          </button>
        </div>
      )}
      {state === 'error' && (
        <p className="pb-4 text-center text-xs font-semibold text-tm-red">
          Could not load more. Try again.
        </p>
      )}
    </>
  )
}
