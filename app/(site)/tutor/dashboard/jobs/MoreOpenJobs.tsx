'use client'

import { useMemo } from 'react'

import InfiniteFooter from '@/components/InfiniteFooter'
import JobCard, { type JobCardData } from '@/components/JobCard'
import { useInfinite } from '@/lib/useInfinite'

// Everything below the server-rendered first window of the open-tuitions
// board. The cards above are real HTML; these are the same component fed from
// JSON by /api/tutor/jobs.
//
// No ads here. The three placements in the revenue spec are the two browse
// pages and the two dashboards, and this is none of them.

export default function MoreOpenJobs({
  initialCursor,
  total,
  serverCount,
  viewerCity = null,
}: {
  initialCursor: string | null
  total: number
  serverCount: number
  viewerCity?: string | null
}) {
  // The board takes no filters, so its identity is fixed — but the key still
  // gets a name of its own so restoring it can never collide with the stored
  // rows of /browse/tuitions, which renders the same cards.
  const storageKey = useMemo(() => 'tm:more:tutor-open-jobs', [])

  const { items, state, done, loadMore, sentinel } = useInfinite<
    JobCardData & { applied?: boolean }
  >({
    endpoint: '/api/tutor/jobs',
    params: {},
    initialCursor,
    storageKey,
  })

  return (
    <>
      {items.length > 0 && (
        <div className="space-y-3">
          {items.map((j) => (
            <div key={j.id} id={j.id} className="scroll-mt-20">
              <JobCard
                job={j}
                signedIn
                showApply
                applied={!!j.applied}
                viewerCity={viewerCity}
              />
            </div>
          ))}
        </div>
      )}

      <InfiniteFooter
        state={state}
        done={done}
        loadMore={loadMore}
        sentinel={sentinel}
        loadedCount={serverCount + items.length}
        total={total}
        noun="tuitions"
      />
    </>
  )
}
