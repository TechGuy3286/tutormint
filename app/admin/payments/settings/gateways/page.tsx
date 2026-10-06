import Link from 'next/link'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { gatewayConfigured, getGatewaySettings, loadGatewayHealth } from '@/lib/payments/gatewaySettings'
import { formatDateTime } from '@/lib/datetime'
import GatewaysClient from './GatewaysClient'
import SettlementCheck from './SettlementCheck'
import { loadSettlement, type SettlementView } from '@/lib/settlement'
import { pkDayKey } from '@/lib/datetime'

// Admin → Settings → Payment gateways (owner, 6 Oct 2026, item 19).
//
// OWNER ONLY, enforced on the server: SCREEN_ACCESS.paymentGateways is `[]`, so
// requireAdminRole admits the owner alone and the change route answers 403 to
// everyone else. Credentials are never shown, entered or stored here — they
// stay in Vercel; "connected" only means the gateway's variables are present.

export const dynamic = 'force-dynamic'

function when(v: string | null): string {
  return v ? formatDateTime(v) : 'Never'
}

const ISO_DAY = /^d{4}-d{2}-d{2}$/

export default async function PaymentGatewaysPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  await requireAdminRole(...SCREEN_ACCESS.paymentGateways)
  const [settings, health] = await Promise.all([getGatewaySettings(), loadGatewayHealth()])
  const configured = gatewayConfigured()

  // Settlement check range (Pakistan time). Default: this month to today.
  const sp = await searchParams
  const today = pkDayKey(new Date())
  let from = sp.from && ISO_DAY.test(sp.from) ? sp.from : `${today.slice(0, 7)}-01`
  let to = sp.to && ISO_DAY.test(sp.to) ? sp.to : today
  if (from > to) [from, to] = [to, from]
  const settlements = new Map<string, SettlementView>()
  for (const g of health.gateways) {
    if (!g.connected) continue
    const v = await loadSettlement(g.id, from, to)
    if (v) settlements.set(g.id, v)
  }

  const card = 'space-y-2 rounded-2xl border border-gray-200 bg-white p-4'

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Payment gateways</h1>
        <p className="text-xs text-gray-500">
          Owner only. Choose the gateway members pay through and which ways to pay are offered. Every change is recorded in
          the{' '}
          <Link href="/admin/audit" className="font-bold text-tm-navy hover:underline">
            audit log
          </Link>
          .
        </p>
      </header>

      <GatewaysClient initial={settings} configured={configured} />

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
            {settlements.has(g.id) && <SettlementCheck view={settlements.get(g.id)!} gatewayName={g.name} />}
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
