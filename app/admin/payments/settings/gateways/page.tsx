import Link from 'next/link'
import { permanentRedirect } from 'next/navigation'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { gatewayConfigured, getGatewaySettings, loadGatewayHealth } from '@/lib/payments/gatewaySettings'
import { formatDateTime } from '@/lib/datetime'
import GatewaysClient from './GatewaysClient'
import BankDetailsForm from '../../bank-details/BankDetailsForm'
import { createAdminClient } from '@/lib/supabase/admin'
import { SETTING_KEYS } from '@/lib/payments/manual'
import { PAYMENT_ALERTS_KEY } from '@/lib/payments/paymentAlerts'
import { bankDetailsComplete } from '@/lib/payments/receiptCore'

// Admin → Settings → Payment gateways (owner, 6 Oct 2026, item 19).
//
// OWNER ONLY, enforced on the server: SCREEN_ACCESS.paymentGateways is `[]`, so
// requireAdminRole admits the owner (and the view-only Partner) and the change
// route answers 403 to everyone else. The settlement check moved to Admin →
// Finance → Settlement check (owner, 8 Oct 2026); this page keeps the gateway
// settings and health only. Credentials are never shown, entered or stored here — they
// stay in Vercel; "connected" only means the gateway's variables are present.

export const dynamic = 'force-dynamic'

function when(v: string | null): string {
  return v ? formatDateTime(v) : 'Never'
}

export default async function PaymentGatewaysPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  await requireAdminRole(...SCREEN_ACCESS.paymentGateways)
  // An old settlement-check link (it carried ?from&to) goes to its new home.
  const sp = await searchParams
  if (sp.from || sp.to) {
    const q = new URLSearchParams()
    if (sp.from) q.set('from', sp.from)
    if (sp.to) q.set('to', sp.to)
    q.set('tab', 'settlement')
    permanentRedirect(`/admin/finance?${q.toString()}`)
  }
  const [settings, health] = await Promise.all([getGatewaySettings(), loadGatewayHealth()])
  const configured = gatewayConfigured()

  // Bank transfer details (owner, 11 Oct 2026): entered here, shown to members
  // on the payment choice screen. Read with the service role for the form.
  const stored = new Map<string, string>()
  const admin = createAdminClient()
  if (admin) {
    const { data } = await admin
      .from('app_settings')
      .select('key, value')
      .in('key', [...Object.values(SETTING_KEYS), PAYMENT_ALERTS_KEY])
    for (const r of data ?? []) stored.set(r.key as string, (r.value as string) ?? '')
  }
  const bank = {
    bankName: stored.get(SETTING_KEYS.bankName) ?? '',
    accountTitle: stored.get(SETTING_KEYS.accountTitle) ?? '',
    accountNumber: stored.get(SETTING_KEYS.accountNumber) ?? '',
    iban: stored.get(SETTING_KEYS.iban) ?? '',
  }
  const bankReady = bankDetailsComplete(bank)

  const card = 'space-y-2 rounded-2xl border border-gray-200 bg-white p-4'

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Payment gateways</h1>
        <p className="text-xs text-gray-500">
          Owner only. Members pay by bank transfer; PayPro is retired. Every change is recorded in
          the{' '}
          <Link href="/admin/audit" className="font-bold text-tm-navy hover:underline">
            audit log
          </Link>
          . The settlement check is under{' '}
          <Link href="/admin/finance" className="font-bold text-tm-navy hover:underline">
            Finance
          </Link>
          .
        </p>
      </header>

      <GatewaysClient initial={settings} configured={configured} />

      <section id="bank-details" className="scroll-mt-24 space-y-2">
        <h2 className="text-sm font-black text-tm-navy">Bank transfer details</h2>
        <p className="text-[11px] text-gray-500">
          Members see these on the payment choice screen under &ldquo;Other methods&rdquo;, each with a Copy
          button. Saving needs your password.
        </p>
        <p
          className={`rounded-xl p-3 text-[11px] font-bold ${
            bankReady && settings.methods.bank_transfer ? 'bg-tm-tint-green text-tm-green-deep' : 'bg-tm-tint-gold text-tm-gold-ink'
          }`}
        >
          {!bankReady
            ? 'Bank transfer is hidden from members: fill in the bank, the account title and an account number or IBAN.'
            : settings.methods.bank_transfer
              ? 'Bank transfer is showing to members.'
              : 'Bank transfer is hidden from members: the switch above is off.'}
        </p>
        <BankDetailsForm
          initial={{
            ...bank,
            bankBranch: stored.get(SETTING_KEYS.bankBranch) ?? '',
            raastId: stored.get(SETTING_KEYS.raastId) ?? '',
            hasQr: !!(stored.get(SETTING_KEYS.qrPath) ?? ''),
          }}
        />
      </section>

      {/* Payment alert emails moved to Notification settings (owner, 27 Oct 2026). */}
      <p className="text-[11px] text-gray-500">
        Which alert emails are sent is set in{' '}
        <Link href="/admin/settings/notifications" className="font-bold text-tm-navy hover:underline">Notification settings</Link>.
      </p>

      <section className="space-y-3">
        <h2 className="text-sm font-black text-tm-navy">Health</h2>
        {health.gateways.map((g) => (
          <div key={g.id} className={card}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-tm-navy">{g.name}</p>
              <span
                className={`rounded-full px-3 py-1 text-[11px] font-black ${
                  g.connected ? 'bg-tm-tint-green text-tm-green-deep' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {g.connected ? 'Connected' : 'Not connected'}
              </span>
            </div>
            <dl className="grid grid-cols-1 gap-1 text-[11px] sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-gray-500">Last successful payment</dt>
                <dd className="text-slate-700">{when(g.lastSuccessAt)}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-500">Last callback received</dt>
                <dd className="text-slate-700">{when(g.lastCallbackAt)}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-semibold text-gray-500">Last error</dt>
                <dd className="text-slate-700">
                  {g.lastError ? `${formatDateTime(g.lastError.at)} — ${g.lastError.message}` : 'None recorded'}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-semibold text-gray-500">Payments waiting more than 1 hour</dt>
                <dd className={g.pendingOverHour > 0 ? 'font-bold text-tm-red' : 'text-slate-700'}>{g.pendingOverHour}</dd>
              </div>
            </dl>
          </div>
        ))}
        <p className="text-[11px] text-gray-500">
          &ldquo;Connected&rdquo; means the gateway&rsquo;s settings are present in Vercel. Callback times are recorded from
          today onwards.
        </p>
      </section>

      <section className={card}>
        <h2 className="text-sm font-black text-tm-navy">PayPro service fee</h2>
        <p className="text-xs text-slate-700">
          <span className="rounded-full bg-tm-tint-navy px-2 py-0.5 text-[11px] font-bold text-tm-navy">Set by PayPro</span>{' '}
          Who pays PayPro&rsquo;s fee is set in the PayPro account, not here. Our connection to PayPro has no setting for it;
          PayPro only tells us on each order whether a fee was applied.
        </p>
        <p className="text-[11px] text-gray-500">
          {health.fee.lastReported
            ? `On the latest order (${when(health.fee.lastOrderAt)}) PayPro reported “fee applied”: ${health.fee.lastReported}.`
            : 'PayPro has not reported a fee on any order yet.'}
        </p>
      </section>

      <p className="text-[11px] text-gray-500">
        Gateway passwords and keys are never shown or entered here. They stay in Vercel.
      </p>
    </div>
  )
}
