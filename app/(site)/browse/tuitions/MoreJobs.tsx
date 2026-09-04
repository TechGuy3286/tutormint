'use client'

import { useMemo } from 'react'

import InlineAd from '@/components/ads/InlineAd'
import InfiniteFooter from '@/components/InfiniteFooter'
import JobCard, { type JobCardData } from '@/components/JobCard'
import { useInfinite } from '@/lib/useInfinite'

// Everything below the server-rendered first window of /browse/tuitions.
// The cards above are real HTML; these are the same component fed from JSON.

export default function MoreJobs({
  params,
  initialCursor,
  total,
  serverCount,
  signedIn,
  showApply,
  adEvery,
  viewerCity = null,
}: {
  params: Record<string, string>
  initialCursor: string | null
  total: number
  serverCount: number
  signedIn: boolean
  showApply: boolean
  adEvery: number
  viewerCity?: string | null
}) {
  const storageKey = useMemo(
    () => `tm:more:tuitions:${new URLSearchParams(params).toString()}`,
    [params],
  )

  const { items, state, done, loadMore, sentinel } = useInfinite<
    JobCardData & { applied?: boolean }
  >({
    endpoint: '/api/browse/tuitions',
    params,
    initialCursor,
    storageKey,
  })

  return (
    <>
      {items.length > 0 && (
        <div className="space-y-4">
          {items.map((j, i) => {
            const position = serverCount + i + 1
            return (
              <div key={j.id} className="space-y-4">
                <JobCard job={j} signedIn={signedIn} showApply={showApply} applied={!!j.applied} viewerCity={viewerCity} />
                {position % adEvery === 0 && (
                  <InlineAd audience="tutors" index={Math.floor(position / adEvery)} />
                )}
              </div>
            )
          })}
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
