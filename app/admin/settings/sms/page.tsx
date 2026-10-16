import { requireAdminRole, roleMayWrite, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadSmsHealth } from '@/lib/smsLog'
import { NO_RECEIPT_LABEL, OWNER_TEST_NOTE, noReceiptNetwork, pkTime } from '@/lib/smsHealthCore'
import SmsTestForm from './SmsTestForm'

// Admin → Settings → SMS (owner, 15 Oct 2026). The Owner, and the Partner view
// only; everyone else is sent away by requireAdminRole. Shows the provider, which
// SendPK settings are present (names only, never a value), the last successful
// send, counts, failures with SendPK's own error text, the SendPK balance, the
// newest log rows (numbers masked, no codes) and the alert history. The Owner can
// send a test SMS.

export const dynamic = 'force-dynamic'

const PURPOSE: Record<string, string> = {
  signup: 'Signup code',
  verify: 'Mobile verification',
  reset: 'Password reset',
  test: 'Test',
  alert: 'Search alert',
}
const OUTCOME: Record<string, string> = {
  sent: 'Sent',
  failed: 'Failed',
  reused: 'Code already sent (nothing new sent)',
  not_sent: 'Not sent (bridge code)',
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: 'bad' | 'good' }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <dt className="text-[11px] font-bold text-gray-600">{label}</dt>
      <dd className={`mt-0.5 text-sm font-bold ${tone === 'bad' ? 'text-tm-red' : tone === 'good' ? 'text-tm-green-deep' : 'text-slate-800'}`}>{value}</dd>
    </div>
  )
}

export default async function SmsSettingsPage() {
  const actor = await requireAdminRole(...SCREEN_ACCESS.smsHealth)
  const canSend = roleMayWrite(actor.adminRole, SCREEN_ACCESS.smsHealth)
  const h = await loadSmsHealth()
  const missing = h.settings.filter((s) => !s.present)

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">SMS</h1>
        <p className="text-xs text-gray-500">
          Verification codes are sent by SMS through {h.provider}. Every code request and send is recorded here for 90 days,
          with the number masked and never the code.
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Fact label="Provider" value={h.provider} tone={h.provider === 'SendPK' ? 'good' : 'bad'} />
        <Fact label="Last successful SMS" value={h.lastSuccessAt ? pkTime(h.lastSuccessAt) : 'None on record yet'} />
        <Fact label="SendPK balance" value={h.balance.ok ? `Rs ${h.balance.pkr.toLocaleString('en-PK', { minimumFractionDigits: 2 })}` : `Not available (${h.balance.error})`} />
        <Fact label="Sent in the last 24 hours" value={String(h.sent24h)} />
        <Fact label="Sent in the last 7 days" value={String(h.sent7d)} />
        <Fact label="Failed in the last 24 hours" value={String(h.failed24h)} tone={h.failed24h > 0 ? 'bad' : undefined} />
      </dl>

      {h.lastError ? (
        <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-3 text-xs text-tm-red">
          Last error ({pkTime(h.lastError.at)}): {h.lastError.text}
        </p>
      ) : null}

      <section className="space-y-1 rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-black text-tm-navy">Settings</h2>
        <ul className="grid gap-1 text-xs sm:grid-cols-2">
          {h.settings.map((s) => (
            <li key={s.name} className="flex items-center justify-between gap-2">
              <code className="text-slate-800">{s.name}</code>
              <span className={s.present ? 'font-bold text-tm-green-deep' : 'font-bold text-tm-red'}>{s.present ? 'Present' : 'Missing'}</span>
            </li>
          ))}
        </ul>
        {missing.length ? (
          <p className="text-xs text-tm-red">Codes cannot be sent until the missing settings are added in Vercel and the site is redeployed.</p>
        ) : null}
      </section>

      {canSend ? <SmsTestForm /> : null}

      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-black text-tm-navy">Recent code requests and sends</h2>
        <p className="text-[11px] text-gray-600">
          Ufone and Zong do not send delivery receipts, so SendPK shows their messages as unconfirmed. That is not a failure.{' '}
          {OWNER_TEST_NOTE}
        </p>
        {h.recent.length === 0 ? (
          <p className="text-xs text-gray-500">Nothing recorded yet. Rows appear here from the first code request after this screen went live.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="text-[11px] text-gray-600">
                <tr>
                  <th className="py-1 pr-2">Time</th>
                  <th className="py-1 pr-2">Purpose</th>
                  <th className="py-1 pr-2">Number</th>
                  <th className="py-1 pr-2">Result</th>
                  <th className="py-1">SendPK id or error</th>
                </tr>
              </thead>
              <tbody className="text-slate-800">
                {h.recent.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100 align-top">
                    <td className="py-1 pr-2 whitespace-nowrap">{pkTime(r.createdAt)}</td>
                    <td className="py-1 pr-2">{PURPOSE[r.purpose] ?? r.purpose}</td>
                    <td className="py-1 pr-2 whitespace-nowrap">{r.toMasked}</td>
                    {r.outcome === 'sent' && noReceiptNetwork(r.toMasked) ? (
                      // Ufone / Zong: sent, and those networks send no receipt
                      // back — grey, not a warning (owner, 17 Oct 2026).
                      <td className="py-1 pr-2 text-gray-600">{NO_RECEIPT_LABEL}</td>
                    ) : (
                      <td className={`py-1 pr-2 font-bold ${r.outcome === 'failed' ? 'text-tm-red' : r.outcome === 'sent' ? 'text-tm-green-deep' : 'text-gray-600'}`}>
                        {OUTCOME[r.outcome] ?? r.outcome}
                      </td>
                    )}
                    <td className="py-1 break-all text-gray-600">{r.outcome === 'failed' ? r.error : r.messageId ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-black text-tm-navy">Alert history</h2>
        <p className="text-xs text-gray-500">
          Checked every hour. The Owner is emailed and notified when an SMS fails to send (a SendPK error or a rejected send),
          when 2 or more signups reach the mobile step in 12 hours and no SMS is sent, or when 6 or more numbers ask for a code
          in 12 hours and fewer than a quarter get one — at most once every 6 hours. A missing delivery receipt never raises
          an alert.
        </p>
        {h.alerts.length === 0 ? (
          <p className="text-xs text-gray-500">No alerts yet.</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {h.alerts.map((a) => (
              <li key={a.id} className="rounded-xl bg-tm-bg p-2 text-slate-800">
                <div className="font-bold">{pkTime(a.createdAt)}</div>
                <div>{a.message}</div>
                {a.reasons.map((x) => (
                  <div key={x} className="text-gray-600">{x}</div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
