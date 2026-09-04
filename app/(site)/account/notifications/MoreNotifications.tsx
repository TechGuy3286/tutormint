'use client'

import ActivityCard from '@/components/dashboard/ActivityCard'
import InfiniteFooter from '@/components/InfiniteFooter'
import { groupFeed } from '@/lib/feedGrouping'
import type { NotificationGroup, NotificationRow } from '@/lib/notificationFeed'
import { notificationsToFeed } from '@/lib/notificationsToFeed'
import { useInfinite } from '@/lib/useInfinite'

// Everything below the server-rendered first window. Same mechanism as the
// browse pages and the admin lists — one hook, one footer, one Load more.

export default function MoreNotifications({
  group,
  initialCursor,
  serverCount,
}: {
  group: NotificationGroup
  initialCursor: string | null
  serverCount: number
}) {
  const params = group === 'all' ? {} : { group }

  const { items, state, done, loadMore, sentinel } = useInfinite<NotificationRow>({
    endpoint: '/api/notifications',
    params,
    initialCursor,
    storageKey: `tm:more:notifications:${group}`,
  })

  return (
    <>
      {/* Grouped within this window only. A run split across the server's
          first page and an appended one stays two cards, because merging them
          would mean re-rendering rows the reader has already scrolled past —
          and the count on a card must always match the rows under it. */}
      {items.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {groupFeed(notificationsToFeed(items), { messages: 'byThread' }).map((g) => (
            <ActivityCard key={g.key} group={g} />
          ))}
        </ul>
      )}

      <InfiniteFooter
        state={state}
        done={done}
        loadMore={loadMore}
        sentinel={sentinel}
        loadedCount={serverCount + items.length}
        noun="notifications"
        endLabel={`That’s all ${serverCount + items.length} notifications.`}
      />
    </>
  )
}
