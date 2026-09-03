'use client'

import InfiniteFooter from '@/components/InfiniteFooter'
import { useInfinite } from '@/lib/useInfinite'
import type { AdminJobRow } from '@/lib/adminJobs'

import JobRow from './JobRow'

export default function MoreJobs({
  params,
  initialCursor,
  serverCount,
  total,
}: {
  params: Record<string, string>
  initialCursor: string | null
  serverCount: number
  total: number
}) {
  const { items, state, done, loadMore, sentinel } = useInfinite<AdminJobRow>({
    endpoint: '/api/admin/jobs',
    params,
    initialCursor,
    storageKey: `tm:more:adminjobs:${new URLSearchParams(params).toString()}`,
  })

  return (
    <>
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((r) => (
            <JobRow key={r.id} row={r} />
          ))}
        </ul>
      )}

      <InfiniteFooter
        state={state}
        done={done}
        loadMore={loadMore}
        sentinel={sentinel}
        loadedCount={serverCount + items.length}
        noun="tuitions"
        endLabel={`That’s every one — ${total} ${total === 1 ? 'tuition' : 'tuitions'}.`}
      />
    </>
  )
}
