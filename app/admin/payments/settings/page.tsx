import Link from 'next/link'
import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { getPaymentSwitches } from '@/lib/payments/switches'
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
  const onboardingMode = await getOnboardingMode()


  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Payment settings</h1>
        <p className="text-xs text-gray-500">
          Owner only. While a switch is off, only owner, staff, seed and test accounts can pay.
          Turning it on opens that payment to every member.
        </p>
      </header>

      {/* Item 19 (owner, 6 Oct 2026): the gateway, ways to pay and health. */}
      <Link
        href="/admin/payments/settings/gateways"
        className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4 hover:border-tm-navy"
      >
        <span>
          <span className="block text-sm font-bold text-tm-navy">Payment gateways</span>
          <span className="block text-[11px] text-gray-500">Bank transfer and bank details.</span>
        </span>
        <span aria-hidden className="text-sm font-black text-tm-navy">→</span>
      </Link>

      <SwitchesForm initial={switches} />

      {/* PR106-G3 §1: the new-onboarding rollout switch. */}
      <OnboardingModeForm initial={onboardingMode} />
    </div>
  )
}
