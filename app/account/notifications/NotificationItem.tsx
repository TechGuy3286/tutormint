import Link from 'next/link'

import type { NotificationRow } from '@/lib/notificationFeed'

// One notification, rendered the same by the server and by the browser.

export default function NotificationItem({ row }: { row: NotificationRow }) {
  const body = (
    <>
      <span className="flex items-start gap-2">
        {!row.read_at && (
          <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-tm-red" />
        )}
        <span
          className={`min-w-0 text-sm ${row.read_at ? 'font-semibold' : 'font-black'} text-tm-navy`}
        >
          {row.title}
        </span>
      </span>
      {row.body && (
        <span className="block pt-1 text-xs leading-relaxed text-slate-700">{row.body}</span>
      )}
      <span className="block pt-1 text-[11px] text-gray-500">
        {/* An explicit time zone, not the runtime's. Without one this formats in
            UTC on the server and in the reader's zone in the browser, which is
            different text for the same instant and a hydration mismatch. */}
        {new Date(row.created_at).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}
      </span>
    </>
  )

  const className = `block rounded-2xl border bg-white p-4 ${
    row.read_at ? 'border-gray-200' : 'border-tm-red/30'
  }`

  return (
    <li>
      {/* A notification is about something. When it carries a destination it is
          a link to that thing; when it does not, it is not dressed up as one. */}
      {row.href ? (
        <Link href={row.href} className={`${className} transition-colors hover:border-tm-navy`}>
          {body}
        </Link>
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
  )
}
