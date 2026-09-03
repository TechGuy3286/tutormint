import Link from 'next/link'

import type { FeedItem } from '@/lib/dashboardFeed'

// The second band: what has happened, newest first.
//
// Every row is a real row from `notifications` or `user_activity_log`. Nothing
// here is synthesised from state -- "your profile is 60% complete" is a fact
// about now, not an event, and it belongs in the band above.
//
// Timestamps carry an explicit timeZone. Without one, toLocaleString formats
// in the runtime's zone: UTC on the server, Asia/Karachi in the browser, which
// is different text for the same instant and a hydration mismatch (React #418
// -- a bug live on this very page before this change).

const TZ = 'Asia/Karachi'

function when(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-PK', {
    day: 'numeric',
    month: 'short',
    timeZone: TZ,
  })
}

export default function ActivityBand({
  items,
  emptyHint,
}: {
  items: FeedItem[]
  emptyHint: string
}) {
  return (
    <section aria-labelledby="activity" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="activity" className="text-[11px] font-black uppercase tracking-wider text-gray-500">
          Activity
        </h2>
        {items.length > 0 && (
          <Link
            href="/account/notifications"
            /* -mr-2 keeps the 44px target without pushing the text off the
               grid the rest of the band is aligned to. */
            className="-mr-2 flex min-h-[44px] items-center px-2 text-[11px] font-bold text-tm-red hover:underline"
          >
            See all
          </Link>
        )}
      </div>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs leading-relaxed text-gray-500">
          {emptyHint}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white">
          {items.map((it) => {
            const body = (
              <span className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  {it.unread && (
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-tm-red"
                    />
                  )}
                  <span
                    className={`truncate text-xs ${
                      it.unread ? 'font-black' : 'font-semibold'
                    } text-tm-navy`}
                  >
                    {it.text}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] text-gray-500">{when(it.at)}</span>
              </span>
            )
            return (
              <li key={it.id}>
                {/* Not every event has an honest destination. A row without one
                    still renders — inventing a link would be worse. */}
                {it.href ? (
                  <Link
                    href={it.href}
                    className="flex min-h-[44px] items-center px-4 py-2.5 transition-colors hover:bg-tm-bg"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="flex min-h-[44px] items-center px-4 py-2.5">{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
