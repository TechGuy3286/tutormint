import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadEmailHealth } from '@/lib/emailHealth'
import { pkTime } from '@/lib/smsHealthCore'

// Admin → Settings → Email (owner, 16 Oct 2026). Every email the site sends goes
// through lib/email/send.ts and is recorded (migration 183): this page shows the
// counts, every bulk run's summary, and each email that failed or was skipped in
// the last 7 days with Resend's own error. Owner and admin; the Partner views.
// Read only.

export const dynamic = 'force-dynamic'

function Fact({ label, value, tone }: { label: string; value: string; tone?: 'bad' | 'good' }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <dt className="text-[11px] font-bold text-gray-600">{label}</dt>
      <dd className={`mt-0.5 text-sm font-bold ${tone === 'bad' ? 'text-tm-red' : tone === 'good' ? 'text-tm-green-deep' : 'text-slate-800'}`}>{value}</dd>
    </div>
  )
}

export default async function EmailSettingsPage() {
  await requireAdminRole(...SCREEN_ACCESS.emailHealth)
  const h = await loadEmailHealth()
  const failed = h.failures.filter((f) => f.status === 'failed')
  const skipped = h.failures.filter((f) => f.status === 'skipped')

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Email</h1>
        <p className="text-xs text-gray-500">
          Emails are sent through Resend, at most 5 requests a second, with lists sent 100 to a request. A refused request
          (too many requests) is waited out and tried again. Every send is recorded here for 90 days. Sign-up confirmation and
          password-reset emails are sent by Supabase over Resend and are not in this log.
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Fact label="Resend" value={h.configured ? 'Configured' : 'RESEND_API_KEY missing'} tone={h.configured ? 'good' : 'bad'} />
        <Fact label="Last email sent" value={h.lastSentAt ? pkTime(h.lastSentAt) : 'None on record yet'} />
        <Fact label="Sent in the last 24 hours" value={String(h.sent24h)} />
        <Fact label="Sent in the last 7 days" value={String(h.sent7d)} />
        <Fact label="Failed in the last 7 days" value={String(h.failed7d)} tone={h.failed7d > 0 ? 'bad' : undefined} />
        <Fact label="Skipped (invalid address), 7 days" value={String(h.skipped7d)} />
      </dl>

      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-black text-tm-navy">Failed emails (last 7 days)</h2>
        {failed.length === 0 ? (
          <p className="text-xs text-gray-500">No email failed in the last 7 days.</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-xs">
            {failed.map((f) => (
              <li key={f.id} className="space-y-0.5 py-2">
                <p className="font-bold text-slate-800">
                  {f.template ?? f.job} to {f.recipient}
                </p>
                <p className="text-gray-500">
                  {pkTime(f.at)} · {f.mode === 'bulk' ? `bulk: ${f.job}` : 'single'} · {f.attempts} attempt{f.attempts === 1 ? '' : 's'}
                  {f.httpStatus ? ` · HTTP ${f.httpStatus}` : ''}
                </p>
                {f.error ? <p className="break-words text-tm-red">{f.error}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-black text-tm-navy">Bulk runs</h2>
        {h.runs.length === 0 ? (
          <p className="text-xs text-gray-500">No bulk run recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-xs">
              <thead className="text-gray-600">
                <tr>
                  <th className="py-1 pr-2 font-bold">When</th>
                  <th className="py-1 pr-2 font-bold">Job</th>
                  <th className="py-1 pr-2 font-bold">Attempted</th>
                  <th className="py-1 pr-2 font-bold">Delivered</th>
                  <th className="py-1 pr-2 font-bold">Failed</th>
                  <th className="py-1 pr-2 font-bold">Skipped</th>
                  <th className="py-1 font-bold">Requests</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-slate-800">
                {h.runs.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1 pr-2">{pkTime(r.startedAt)}</td>
                    <td className="py-1 pr-2">{r.job}</td>
                    <td className="py-1 pr-2">{r.attempted}</td>
                    <td className="py-1 pr-2">{r.delivered}</td>
                    <td className={`py-1 pr-2 ${r.failed > 0 ? 'font-bold text-tm-red' : ''}`}>{r.failed}</td>
                    <td className="py-1 pr-2">{r.skipped}</td>
                    <td className="py-1">{r.finishedAt ? r.requests : 'running…'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {skipped.length > 0 ? (
        <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-black text-tm-navy">Skipped: invalid address (last 7 days)</h2>
          <ul className="divide-y divide-gray-100 text-xs">
            {skipped.map((f) => (
              <li key={f.id} className="py-2">
                <span className="font-bold text-slate-800">{f.template ?? f.job}</span> to {f.recipient} · {pkTime(f.at)} · {f.error}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
