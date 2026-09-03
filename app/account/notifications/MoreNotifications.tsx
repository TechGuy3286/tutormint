'use client'

import InfiniteFooter from '@/components/InfiniteFooter'
import type { NotificationGroup, NotificationRow } from '@/lib/notificationFeed'
import { useInfinite } from '@/lib/useInfinite'

import NotificationItem from './NotificationItem'

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
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((n) => (
            <NotificationItem key={n.id} row={n} />
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
