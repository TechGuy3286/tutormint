import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { indexingQueueReport } from '@/lib/googleIndexing'
import { SKIP_NOTE, SUPERSEDED_NOTE } from '@/lib/googleIndexingCore'
import { formatDateTime } from '@/lib/datetime'
import IndexingHealth from './IndexingHealth'

// /admin/seo/indexing — what Google has been told (owner, 12 Oct 2026).
// Read-only; same access as the other SEO screens.
//
// Google is sent "updated" when a tuition is posted, edited, resumed, refreshed
// or paused (a paused page stays live and indexable for 60 days), and "removed"
// when one is closed or hired (owner, 16 Oct 2026). Google allows 200 a day,
// counted from midnight Pacific time; new posts go first, failures are retried.
// The health box (sent today, the last 7 days, the last 10 errors) is on top.

export const dynamic = 'force-dynamic'

function result(row: { sent_at: string | null; last_error: string | null; skip_reason: string | null }): { text: string; cls: string } {
  if (!row.sent_at) return { text: row.last_error ? 'Waiting (tried before; will try again)' : 'Waiting', cls: 'bg-tm-tint-gold text-tm-gold-ink' }
  if (row.skip_reason === 'not_tuition') return { text: SKIP_NOTE.not_tuition, cls: 'bg-tm-bg text-gray-600' }
  if (row.skip_reason === 'old_address') return { text: SKIP_NOTE.old_address, cls: 'bg-tm-bg text-gray-600' }
  if (row.last_error === SUPERSEDED_NOTE) return { text: 'Not sent — a newer notice replaced it', cls: 'bg-tm-bg text-gray-600' }
  if (row.last_error) return { text: 'Failed', cls: 'bg-tm-tint-red text-tm-red' }
  return { text: 'Accepted by Google', cls: 'bg-tm-tint-green text-tm-green-deep' }
}

export default async function AdminIndexingPage() {
  await requireAdminRole(...SCREEN_ACCESS.seo)
  const r = await indexingQueueReport()
  const waiting = r.waitingUpdated + r.waitingDeleted

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-black text-tm-navy">Google indexing notices</h1>
        <p className="max-w-3xl text-xs text-gray-500">
          Only single tuition pages are sent: Google is told when a tuition is posted, edited, resumed or paused
          (updated) and when it is closed or hired (removed). Hubs, tutor profiles, blog posts and other pages are
          found through the sitemap. Google allows {r.limit} notices a day, counted from midnight Pacific time (next reset{' '}
          {formatDateTime(r.resetsAt)}). New posts go first; failures are tried again later.
        </p>
      </header>

      {!r.configured && (
        <p className="rounded-xl bg-tm-tint-red p-3 text-xs font-bold text-tm-red">
          The Google Indexing API is not connected, so no notices are being sent.
        </p>
      )}

      <IndexingHealth
        sentToday={r.sentToday}
        limit={r.limit}
        days={r.days}
        errors={r.errors}
        skips={r.skipsToday}
        quotaStopped={r.quotaStopped}
        resetsAt={r.resetsAt}
      />

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Sent today" value={`${r.sentToday} of ${r.limit}`} />
        <Stat label="Waiting — new and resumed" value={String(r.waitingUpdated)} />
        <Stat label="Waiting — removed" value={String(r.waitingDeleted)} />
        <Stat label="Failed today" value={String(r.failedToday)} />
      </dl>

      {waiting > 0 && (
        <p className="text-xs text-gray-500">
          {waiting} waiting. At {r.limit} a day that is about {Math.max(1, Math.ceil(waiting / r.limit))} day
          {Math.ceil(waiting / r.limit) > 1 ? 's' : ''} to clear, if nothing new is added.
        </p>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-black text-tm-navy">Newest notices</h2>
        {r.rows.length === 0 ? (
          <p className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-500">No notices yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
            {r.rows.map((row) => {
              const res = result(row)
              return (
                <li key={row.id} className="space-y-1 p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-tm-tint-navy px-2 py-0.5 text-[11px] font-bold text-tm-navy">
                      {row.kind === 'URL_DELETED' ? 'Removed' : 'Updated'}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${res.cls}`}>{res.text}</span>
                    <span className="text-gray-500">
                      Queued {formatDateTime(row.created_at)}
                      {row.sent_at && row.last_error !== SUPERSEDED_NOTE ? ` · sent ${formatDateTime(row.sent_at)}` : ''}
                    </span>
                  </div>
                  <a href={row.url} target="_blank" rel="noopener noreferrer" className="block break-all font-semibold text-tm-navy hover:underline">
                    {row.url.replace(/^https?:\/\/[^/]+/, '')}
                  </a>
                  {row.last_error && row.last_error !== SUPERSEDED_NOTE && (
                    <p className="break-words text-gray-600">Google said: {row.last_error.slice(0, 240)}</p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3">
      <dt className="text-[11px] font-bold text-gray-500">{label}</dt>
      <dd className="text-lg font-black text-tm-navy">{value}</dd>
    </div>
  )
}
