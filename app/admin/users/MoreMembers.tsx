'use client'

import InfiniteFooter from '@/components/InfiniteFooter'
import type { MemberRow as Row } from '@/lib/memberFeed'
import { useInfinite } from '@/lib/useInfinite'

import MemberRow from './MemberRow'

export default function MoreMembers({
  params,
  initialCursor,
  serverCount,
}: {
  params: Record<string, string>
  initialCursor: string | null
  serverCount: number
}) {
  const { items, state, done, loadMore, sentinel } = useInfinite<Row>({
    endpoint: '/api/admin/users',
    params,
    initialCursor,
    storageKey: `tm:more:members:${new URLSearchParams(params).toString()}`,
  })

  return (
    <>
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((r) => (
            <MemberRow key={r.id} row={r} />
          ))}
        </ul>
      )}

      <InfiniteFooter
        state={state}
        done={done}
        loadMore={loadMore}
        sentinel={sentinel}
        loadedCount={serverCount + items.length}
        noun="members"
        endLabel={`That’s everyone — ${serverCount + items.length} members.`}
      />
    </>
  )
}
