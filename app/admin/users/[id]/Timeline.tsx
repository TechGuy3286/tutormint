import Link from 'next/link'

import { TIMELINE_TABS, type TimelineGroup } from '@/lib/memberTimelineCore'
import MoreTimeline from './MoreTimeline'
import TimelineRow, { type TimelineEvent } from './TimelineRow'

// The ONE member timeline (owner, 20 Oct 2026): the member's own events, every
// admin action about them (with who did it) and their visits, in one list with
// the existing tabs. It replaced three boxes — "Admin actions about them",
// "Activity" and the old timeline — that repeated each other. The tabs are
// links, so a filtered timeline is an address staff can share. The count in
// the header is the length of the grouped list, so it matches the closing line.

export type { TimelineEvent }

export default function Timeline({
  events,
  memberId,
  group,
  initialCursor,
  total,
  summaryLine,
}: {
  events: TimelineEvent[]
  memberId: string
  group: TimelineGroup
  initialCursor: string | null
  total: number
  /** "2 sessions · 6 min in the last 30 days · last seen …" (Activity tab). */
  summaryLine: string | null
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
        {TIMELINE_TABS.map((g) => (
          <Link
            key={g.key}
            href={`/admin/users/${memberId}${g.key === 'all' ? '' : `?group=${g.key}`}`}
            scroll={false}
            aria-current={group === g.key ? 'page' : undefined}
            className={`inline-flex min-h-[44px] items-center rounded-xl px-4 text-xs font-bold ${
              group === g.key ? 'bg-tm-black text-white' : 'border border-gray-200 bg-white text-slate-700'
            }`}
          >
            {g.label}
          </Link>
        ))}
      </nav>

      {group === 'activity' && summaryLine && (
        <p className="rounded-2xl border border-gray-200 bg-white p-3 text-xs font-semibold text-tm-navy">{summaryLine}</p>
      )}

      {events.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
          Nothing recorded in this group.
        </p>
      ) : (
        <>
          <ol className="space-y-2">
            {events.map((e) => (
              <TimelineRow key={e.id} event={e} memberId={memberId} />
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
