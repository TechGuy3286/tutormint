'use client'

import InfiniteFooter from '@/components/InfiniteFooter'
import { useInfinite } from '@/lib/useInfinite'

import AuditEntry, { type AuditRow } from './AuditEntry'

// Everything below the server-rendered first window of the audit trail.
//
// The trail has no cheap total — it grows without bound and counting it on
// every request would be the most expensive query on the screen — so the footer
// reports what has been loaded rather than "x of y", and the end is reached
// when a window comes back short.

export default function MoreEntries({
  params,
  initialCursor,
  serverCount,
}: {
  params: Record<string, string>
  initialCursor: string | null
  serverCount: number
}) {
  const { items, state, done, loadMore, sentinel } = useInfinite<AuditRow>({
    endpoint: '/api/admin/audit',
    params,
    initialCursor,
    storageKey: `tm:more:audit:${new URLSearchParams(params).toString()}`,
  })

  return (
    <>
      {items.length > 0 && (
        <ol className="space-y-2">
          {items.map((e) => (
            <AuditEntry key={e.id} entry={e} />
          ))}
        </ol>
      )}

      <InfiniteFooter
        state={state}
        done={done}
        loadMore={loadMore}
        sentinel={sentinel}
        loadedCount={serverCount + items.length}
        noun="entries"
        endLabel={
          serverCount + items.length === 0
            ? 'Nothing matches that.'
            : `End of the trail — ${serverCount + items.length} entries.`
        }
      />
    </>
  )
}
