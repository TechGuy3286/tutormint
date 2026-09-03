'use client'

import InfiniteFooter from '@/components/InfiniteFooter'
import { useInfinite } from '@/lib/useInfinite'

import TimelineRow, { type TimelineEvent } from './TimelineRow'

// The rest of one member's timeline.
//
// The member id and the group both go into the storage key: coming back to a
// DIFFERENT member, or a different filter, must never restore the previous
// one's rows -- and on this screen that would mean showing one person's
// activity under another person's name.

export default function MoreTimeline({
  memberId,
  group,
  initialCursor,
  serverCount,
  total,
}: {
  memberId: string
  group: string
  initialCursor: string | null
  serverCount: number
  total: number
}) {
  const { items, state, done, loadMore, sentinel } = useInfinite<TimelineEvent>({
    endpoint: '/api/admin/queues/timeline',
    params: { userId: memberId, group },
    initialCursor,
    storageKey: `tm:more:admin-timeline:${memberId}:${group}`,
  })

  return (
    <>
      {items.length > 0 && (
        <ol className="space-y-2">
          {items.map((e) => (
            <TimelineRow key={e.id} event={e} />
          ))}
        </ol>
      )}

      <InfiniteFooter
        state={state}
        done={done}
        loadMore={loadMore}
        sentinel={sentinel}
        loadedCount={serverCount + items.length}
        total={total}
        noun="events"
        endLabel={`That’s the whole timeline — ${serverCount + items.length} events.`}
      />
    </>
  )
}
