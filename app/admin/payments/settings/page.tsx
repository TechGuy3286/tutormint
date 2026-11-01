import Link from 'next/link'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { getPaymentSwitches } from '@/lib/payments/switches'
import { getOnboardingMode } from '@/lib/onboardingModeServer'
import { gatewayConfigured, getGatewaySettings } from '@/lib/payments/gatewaySettings'
import { createAdminClient } from '@/lib/supabase/admin'
import { SETTING_KEYS } from '@/lib/payments/manual'
import { bankDetailsComplete } from '@/lib/payments/receiptCore'
import { loadReaderState } from '@/lib/bankEmailReader'
import { readerFailingAlert } from '@/lib/bankEmailCore'
import { loadPayproCutoff } from '@/lib/payments/payproCutoff'
import { loadFeePrice, loadFeeRange } from '@/lib/feeMatch'
import { loadPayproSettlement } from '@/lib/payproSettlement'
import PayproSettlementCard from '@/components/admin/PayproSettlementCard'
import { PAYMENT_SETTINGS_SECTIONS } from '@/lib/paymentSettingsCore'

import SwitchesForm from './SwitchesForm'
import OnboardingModeForm from './OnboardingModeForm'
import GatewaysClient from './gateways/GatewaysClient'
import BankDetailsForm from '../bank-details/BankDetailsForm'
import ReaderSwitch from '../../finance/settings/ReaderSwitch'
import FinanceSettingsView from '../../finance/settings/FinanceSettingsView'
import FeeRangeForm from '../../finance/settings/FeeRangeForm'

// Payments → Settings (owner, 31 Oct 2026): ONE page for every payment
// setting. It merges the old Payment settings, Payment gateways and Finance →
// Settings pages, whose addresses now redirect here (each to its section).
//
// OWNER ONLY, enforced on the server, exactly as before: every section's list
// in SCREEN_ACCESS is `[]` (owner; the Partner views), and every change route
// keeps its own check and its password re-check (requireFreshAuth). Nothing
// about who may change what moved with the screens.

export const dynamic = 'force-dynamic'

export default async function PaymentSettingsPage() {
  await requireAdminRole(...SCREEN_ACCESS.paymentsSwitches)
  const admin = createAdminClient()
  const [switches, onboardingMode, gateway, reader, cutoff, range, price, paypro, stored] = await Promise.all([
    getPaymentSwitches(),
    getOnboardingMode(),
    getGatewaySettings(),
    loadReaderState(),
    loadPayproCutoff(),
    loadFeeRange(),
    loadFeePrice(),
    loadPayproSettlement().catch(() => null),
    (async () => {
      const m = new Map<string, string>()
      if (!admin) return m
      const { data } = await admin.from('app_settings').select('key, value').in('key', Object.values(SETTING_KEYS))
      for (const r of data ?? []) m.set(r.key as string, (r.value as string) ?? '')
      return m
    })(),
  ])
  const bank = {
    bankName: stored.get(SETTING_KEYS.bankName) ?? '',
    accountTitle: stored.get(SETTING_KEYS.accountTitle) ?? '',
    accountNumber: stored.get(SETTING_KEYS.accountNumber) ?? '',
    iban: stored.get(SETTING_KEYS.iban) ?? '',
  }
  const bankReady = bankDetailsComplete(bank)
  const red = readerFailingAlert(reader, new Date())

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Payment settings</h1>
        <p className="text-xs text-gray-500">
          Owner only. Every change needs your password and is recorded in the{' '}
          <Link href="/admin/audit" className="font-bold text-tm-navy hover:underline">audit log</Link>.
        </p>
        <nav aria-label="Sections" className="flex flex-wrap gap-2 pt-1">
          {PAYMENT_SETTINGS_SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="inline-flex min-h-[36px] items-center rounded-full border border-gray-200 bg-white px-3 text-[11px] font-bold text-tm-navy hover:border-tm-navy">
              {s.label}
            </a>
          ))}
        </nav>
      </header>

      <section id="fee-and-plans" className="scroll-mt-24 space-y-3">
        <h2 className="text-sm font-black text-tm-navy">Fee and plans switches</h2>
        <p className="text-[11px] text-gray-500">While a switch is off, only owner, staff, seed and test accounts can pay. Turning it on opens that payment to every member.</p>
        <SwitchesForm initial={switches} />
        <OnboardingModeForm initial={onboardingMode} />
      </section>

      <section id="bank-transfer" className="scroll-mt-24 space-y-3">
        <h2 className="text-sm font-black text-tm-navy">Bank transfer details</h2>
        <GatewaysClient initial={gateway} configured={gatewayConfigured()} />
        <p className="text-[11px] text-gray-500">
          Members see these on the payment choice screen under &ldquo;Other methods&rdquo;, each with a Copy button.
        </p>
        <p className={`rounded-xl p-3 text-[11px] font-bold ${bankReady && gateway.methods.bank_transfer ? 'bg-tm-tint-green text-tm-green-deep' : 'bg-tm-tint-gold text-tm-gold-ink'}`}>
          {!bankReady
            ? 'Bank transfer is hidden from members: fill in the bank, the account title and an account number or IBAN.'
            : gateway.methods.bank_transfer
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

      <section id="fee-match-and-reader" className="scroll-mt-24 space-y-3">
        <h2 className="text-sm font-black text-tm-navy">Fee match range and bank email reader</h2>
        <FinanceSettingsView
          embedded
          s={reader}
          cutoff={cutoff}
          red={red}
          switchNode={<ReaderSwitch enabled={reader.enabled} configured={reader.configured} />}
          feeRangeNode={<FeeRangeForm min={range.min} max={range.max} price={price} />}
        />
      </section>

      <section id="paypro" className="scroll-mt-24 space-y-3">
        <h2 className="text-sm font-black text-tm-navy">PayPro settlement status</h2>
        {paypro ? (
          <PayproSettlementCard pending={paypro.pending} unsettled={paypro.unsettled.length} oldest={paypro.oldestUnsettled} />
        ) : (
          <p className="text-xs text-gray-500">PayPro settlement could not be read just now.</p>
        )}
      </section>

      <p className="text-[11px] text-gray-500">
        Which alert emails are sent is set in{' '}
        <Link href="/admin/settings/notifications" className="font-bold text-tm-navy hover:underline">Notification settings</Link>. Gateway
        passwords and keys are never shown or entered here; they stay in Vercel.
      </p>
    </div>
  )
}
