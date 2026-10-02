import { loadActivitySummary, loadActivitySessions } from '@/lib/adminActivity'
import { describeActivityEvent, humanDuration } from '@/lib/activityTrack'
import { formatDateTime } from '@/lib/datetime'
import MoreActivity from './MoreActivity'

// Member activity (PR99 §2) on /admin/users/[id]: a summary row, then the
// newest-first, session-grouped list of what the member did, in plain English.
// owner/admin only — the page already gates with requireAdminRole(users), and
// the data comes from service-role reads of the admin-only activity tables.

export default async function MemberActivity({ userId }: { userId: string }) {
  const [summary, first] = await Promise.all([
    loadActivitySummary(userId),
    loadActivitySessions(userId),
  ])

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-black text-tm-navy">Activity</h2>
        {summary.lastSeen && (
          <p className="text-[11px] text-gray-500">Last seen {formatDateTime(summary.lastSeen)}</p>
        )}
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 gap-3 rounded-2xl border border-gray-200 bg-white p-4 sm:grid-cols-4">
        <Stat label="Sessions (7d)" value={String(summary.sessions7)} />
        <Stat label="Sessions (30d)" value={String(summary.sessions30)} />
        <Stat label="Time spent (7d)" value={humanDuration(summary.timeMs7)} />
        <Stat label="Time spent (30d)" value={humanDuration(summary.timeMs30)} />
      </div>

      {(summary.staff || summary.seed) && (
        <p className="text-[11px] text-gray-500">
          {summary.staff ? 'Staff account.' : ''} {summary.seed ? 'Seed/test account.' : ''}
        </p>
      )}

      {summary.topSearches.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">
            Top searches (30d)
          </p>
          <ul className="flex flex-wrap gap-2">
            {summary.topSearches.map((s) => (
              <li key={s.term} className="rounded-full bg-tm-bg px-3 py-1 text-[11px] font-semibold text-tm-navy">
                {s.term} <span className="text-gray-500">· {s.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {first.rows.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">
          No activity recorded yet.
        </p>
      ) : (
        <>
          <ol className="space-y-3">
            {first.rows.map((s) => (
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
          <MoreActivity userId={userId} initialCursor={first.nextCursor} />
        </>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="truncate text-sm font-black text-tm-navy">{value}</p>
    </div>
  )
}
