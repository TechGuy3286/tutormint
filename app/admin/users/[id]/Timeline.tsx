import Link from 'next/link'

import MoreTimeline from './MoreTimeline'
import TimelineRow, { type TimelineEvent } from './TimelineRow'

// The member activity timeline.
//
// A server component: it renders the first window the page already fetched,
// and the group filter is a link rather than client state, so a filtered
// timeline is a URL an admin can share.
//
// THE FILTER MOVED INTO THE QUERY. It used to fetch 300 rows and filter them
// in JavaScript, which meant a member with 300 logins had an empty "Money"
// tab -- the group was filtering a window that had never reached a payment.
// lib/adminQueues.ts now applies the group in the `where`, and the list pages
// from there.

export type { TimelineEvent }

const GROUPS = [
  { key: 'all', label: 'Everything' },
  { key: 'account', label: 'Account' },
  { key: 'activity', label: 'Activity' },
  { key: 'money', label: 'Money' },
  { key: 'moderation', label: 'Moderation' },
]

export default function Timeline({
  events,
  memberId,
  group,
  initialCursor,
  total,
}: {
  events: TimelineEvent[]
  memberId: string
  group: string
  initialCursor: string | null
  total: number
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-black text-tm-navy">Timeline</h2>
        <p className="text-[11px] text-gray-500">
          {total} event{total === 1 ? '' : 's'}, newest first
        </p>
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="Timeline filter">
        {GROUPS.map((g) => (
          <Link
            key={g.key}
            href={`/admin/users/${memberId}${g.key === 'all' ? '' : `?group=${g.key}`}`}
            aria-current={group === g.key ? 'page' : undefined}
            className={`inline-flex min-h-[44px] items-center rounded-xl px-4 text-xs font-bold ${
              group === g.key
                ? 'bg-tm-black text-white'
                : 'border border-gray-200 bg-white text-slate-700'
            }`}
          >
            {g.label}
          </Link>
        ))}
      </nav>

      {events.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
          Nothing recorded in this group.
        </p>
      ) : (
        <>
          <ol className="space-y-2">
            {events.map((e) => (
              <TimelineRow key={e.id} event={e} />
            ))}
          </ol>
          <MoreTimeline
            memberId={memberId}
            group={group}
            initialCursor={initialCursor}
            serverCount={events.length}
            total={total}
          />
        </>
      )}
    </section>
  )
}
