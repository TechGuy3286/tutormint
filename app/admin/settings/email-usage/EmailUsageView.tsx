import { dayTotals, type UsageRow } from '@/lib/email/usageCore'
import { EMAIL_TYPE_LABEL, criticalOnlyFrom } from '@/lib/email/policyCore'

// The Email usage table (owner, 27 Oct 2026) — presentational; the page loads
// the rows. No address is shown.

const th = 'p-2 text-left text-[10px] font-bold uppercase tracking-wide text-gray-500'
const td = 'p-2 text-xs text-slate-700'

export default function EmailUsageView({ rows, dailyLimit }: { rows: UsageRow[]; dailyLimit: number }) {
  const days = dayTotals(rows)
  return (
    <div className="mx-auto max-w-5xl space-y-5" data-email-usage="">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Email usage</h1>
        <p className="text-xs text-gray-500">
          Last 30 days, by UTC day. Daily limit {dailyLimit}; from {criticalOnlyFrom(dailyLimit)} only critical emails go and the rest wait for the next
          day. Sign-up confirmations and password resets sent by the sign-in system are not in this log.
        </p>
      </header>
      {days.length === 0 && <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-500">No emails in the last 30 days.</p>}
      {days.map((d) => (
        <section key={d.day} className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4" data-usage-day={d.day}>
          <h2 className="text-sm font-black text-tm-navy">
            {d.day} · {d.sent} sent · {d.skipped} skipped · {d.failed} failed · {d.queued} held
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead className="border-b border-gray-200">
                <tr>
                  <th className={th}>Type</th>
                  <th className={`${th} text-right`}>Sent</th>
                  <th className={`${th} text-right`}>Skipped</th>
                  <th className={`${th} text-right`}>Failed</th>
                  <th className={`${th} text-right`}>Held</th>
                  <th className={th}>Why skipped</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows
                  .filter((r) => r.day === d.day)
                  .map((r) => (
                    <tr key={r.template}>
                      <td className={td}>{EMAIL_TYPE_LABEL[r.template] ?? r.template}</td>
                      <td className={`${td} text-right tabular-nums`}>{r.sent}</td>
                      <td className={`${td} text-right tabular-nums`}>{r.skipped}</td>
                      <td className={`${td} text-right tabular-nums ${r.failed > 0 ? 'font-bold text-tm-red' : ''}`}>{r.failed}</td>
                      <td className={`${td} text-right tabular-nums`}>{r.queued}</td>
                      <td className={td}>
                        {Object.entries(r.skipReasons)
                          .map(([why, n]) => `${why} (${n})`)
                          .join('; ') || '—'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}
