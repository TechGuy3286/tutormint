'use client'

import { useState } from 'react'
import { describeActivityEvent, humanDuration } from '@/lib/activityTrack'
import { formatDateTime } from '@/lib/datetime'
import type { ActivitySessionRow } from '@/lib/adminActivity'

// Load-more for the member activity session list (PR99 §2). Appends older
// sessions from the admin-gated route; keyset cursor on started_at.

export default function MoreActivity({
  userId,
  initialCursor,
}: {
  userId: string
  initialCursor: string | null
}) {
  const [rows, setRows] = useState<ActivitySessionRow[]>([])
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [busy, setBusy] = useState(false)

  if (!cursor && rows.length === 0) return null

  const loadMore = async () => {
    if (!cursor || busy) return
    setBusy(true)
    try {
      const res = await fetch(
        `/api/admin/activity/sessions?userId=${encodeURIComponent(userId)}&cursor=${encodeURIComponent(cursor)}`,
      )
      const data = (await res.json()) as { rows?: ActivitySessionRow[]; nextCursor?: string | null }
      if (res.ok) {
        setRows((r) => [...r, ...(data.rows ?? [])])
        setCursor(data.nextCursor ?? null)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {rows.length > 0 && (
        <ol className="space-y-3">
          {rows.map((s) => (
            <li key={s.id} className="rounded-2xl border border-gray-200 bg-white p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs font-bold text-tm-navy">{formatDateTime(s.startedAt)}</p>
                <p className="text-[11px] text-gray-500">
                  {humanDuration(s.activeMs)} · {s.pageCount} page{s.pageCount === 1 ? '' : 's'}
                </p>
              </div>
              {s.events.length === 0 ? (
                <p className="text-[11px] text-gray-300">No events in this session.</p>
              ) : (
                <ul className="space-y-1">
                  {s.events.map((e) => (
                    <li key={e.id} className="flex items-baseline justify-between gap-2 text-[11px]">
                      <span className="min-w-0 truncate text-slate-700">{describeActivityEvent(e)}</span>
                      <span className="shrink-0 text-gray-500">{formatDateTime(e.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}

      {cursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={busy}
          className="min-h-[44px] w-full rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700 hover:border-tm-navy disabled:opacity-60"
        >
          {busy && <span aria-hidden className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />} Load more sessions
        </button>
      )}
    </>
  )
}
