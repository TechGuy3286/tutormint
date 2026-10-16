import { formatDateTime } from '@/lib/datetime'
import type { IndexingDay, IndexingError, IndexingSkips } from '@/lib/googleIndexing'

// "Indexing API health" (owner, 16 Oct 2026): requests sent in Google's day
// against the 200 allowance, the last 7 days (worked / failed) as a small bar
// chart, and the last 10 errors Google gave. Server component, read-only.

export default function IndexingHealth({
  sentToday,
  limit,
  days,
  errors,
  skips,
  quotaStopped,
  resetsAt,
}: {
  sentToday: number
  limit: number
  days: IndexingDay[]
  errors: IndexingError[]
  /** Notices not sent today, by reason (owner, 16 Oct 2026). */
  skips: IndexingSkips
  /** Google refused on its quota today: nothing more is sent until resetsAt. */
  quotaStopped: boolean
  resetsAt: string
}) {
  const peak = Math.max(limit, ...days.map((d) => d.ok + d.failed))
  const pct = Math.min(100, Math.round((sentToday / limit) * 100))
  return (
    <section aria-labelledby="indexing-health" className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <h2 id="indexing-health" className="text-sm font-black text-tm-navy">
        Indexing API health
      </h2>

      <div className="space-y-1">
        <p className="text-xs font-bold text-slate-700">
          Sent today: {sentToday} of {limit}
        </p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-tm-bg" aria-hidden>
          <div className={`h-full rounded-full ${pct >= 100 ? 'bg-tm-red' : 'bg-tm-navy'}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {quotaStopped && (
        <p className="rounded-xl bg-tm-tint-gold p-3 text-xs font-bold text-tm-gold-ink">
          Google refused a notice today because its daily limit is used up. Nothing more is sent until{' '}
          {formatDateTime(resetsAt)}.
        </p>
      )}

      <div className="space-y-1">
        <p className="text-xs font-bold text-slate-700">Not sent today</p>
        <ul className="space-y-0.5 text-xs text-slate-700">
          <li>Not a tuition page: {skips.notTuition}</li>
          <li>Old address (redirects or not canonical): {skips.oldAddress}</li>
          <li>Replaced by a newer notice: {skips.superseded}</li>
        </ul>
      </div>

      <figure className="space-y-2">
        <figcaption className="text-xs font-bold text-slate-700">Last 7 days</figcaption>
        <div className="flex h-28 items-end gap-2">
          {days.map((d) => {
            const total = d.ok + d.failed
            return (
              <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[10px] tabular-nums text-gray-500">{total}</span>
                <div className="flex w-full flex-col justify-end overflow-hidden rounded-t" style={{ height: `${(total / peak) * 100}%` }}>
                  {d.failed > 0 && <div className="w-full bg-tm-red" style={{ height: `${(d.failed / Math.max(1, total)) * 100}%` }} />}
                  <div className="w-full flex-1 bg-tm-navy" />
                </div>
                <span className="text-[10px] text-gray-500">{d.day.slice(5)}</span>
              </div>
            )
          })}
        </div>
        <p className="text-[11px] text-gray-500">
          Navy: accepted by Google. Red: failed (tried again later). Days are Google&apos;s days (Pacific time).
        </p>
        <table className="sr-only">
          <caption>Requests per day</caption>
          <thead>
            <tr>
              <th>Day</th>
              <th>Accepted</th>
              <th>Failed</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day}>
                <td>{d.day}</td>
                <td>{d.ok}</td>
                <td>{d.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figure>

      <div className="space-y-2">
        <h3 className="text-xs font-bold text-slate-700">Last 10 errors (newest first)</h3>
        {errors.length === 0 ? (
          <p className="text-xs text-gray-500">No errors.</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-xs">
            {errors.map((e, i) => (
              <li key={`${e.attempted_at}-${i}`} className="space-y-0.5 py-2">
                <p className="text-gray-500">
                  {formatDateTime(e.attempted_at)} · {e.kind === 'URL_DELETED' ? 'Removed' : 'Updated'}
                </p>
                <p className="break-all font-semibold text-tm-navy">{e.url}</p>
                <p className="break-words text-tm-red">{e.error}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
