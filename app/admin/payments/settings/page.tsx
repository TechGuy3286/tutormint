import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { getPaymentSwitches } from '@/lib/payments/switches'
import { payproMode } from '@/lib/payments/paypro'
import { getOnboardingMode } from '@/lib/onboardingModeServer'
import SwitchesForm from './SwitchesForm'
import OnboardingModeForm from './OnboardingModeForm'

// Owner-only "open payments" switches (PR105 §1). Both default OFF; turning one
// ON opens that kind of checkout to every member (the Rs 199 fee, or the paid
// plans). Changing a switch needs the owner's password and is audit-logged.

export const dynamic = 'force-dynamic'

export default async function PaymentSettingsPage() {
  await requireAdminRole(...SCREEN_ACCESS.paymentsSwitches)
  const switches = await getPaymentSwitches()
  const mode = payproMode()
  const onboardingMode = await getOnboardingMode()

  const modeLabel = mode === 'live' ? 'Live' : mode === 'sandbox' ? 'Sandbox' : 'Not set'
  const modeTone =
    mode === 'live' ? 'bg-tm-tint-green text-tm-green-deep'
      : mode === 'sandbox' ? 'bg-tm-tint-gold text-tm-gold-ink'
        : 'bg-gray-100 text-gray-500'

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Payment settings</h1>
        <p className="text-xs text-gray-500">
          Owner only. While a switch is off, only owner, staff, seed and test accounts can pay.
          Turning it on opens that payment to every member.
        </p>
      </header>

      {/* PR106-G3 §4: the PayPro mode, derived from the configured base URL host
          — never the secret value. */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4">
        <div>
          <p className="text-sm font-bold text-tm-navy">PayPro mode</p>
          <p className="text-[11px] text-gray-500">Live card payments are open to everyone only when this is Live.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-black ${modeTone}`}>{modeLabel}</span>
      </div>

      <SwitchesForm initial={switches} />

      {/* PR106-G3 §1: the new-onboarding rollout switch. */}
      <OnboardingModeForm initial={onboardingMode} />
    </div>
  )
}
