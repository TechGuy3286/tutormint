import Link from 'next/link'
import { permanentRedirect } from 'next/navigation'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { gatewayConfigured, getGatewaySettings } from '@/lib/payments/gatewaySettings'
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
// Finance → Settlement check (owner, 8 Oct 2026); this page keeps bank transfer
// and its details only (gateway health cards removed, owner 31 Oct 2026). Credentials are never shown, entered or stored here — they
// stay in Vercel; "connected" only means the gateway's variables are present.

export const dynamic = 'force-dynamic'

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
  const settings = await getGatewaySettings()
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

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Payment gateways</h1>
        <p className="text-xs text-gray-500">
          Owner only. Members pay by bank transfer. Every change is recorded in
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

      <p className="text-[11px] text-gray-500">
        Gateway passwords and keys are never shown or entered here. They stay in Vercel.
      </p>
    </div>
  )
}
