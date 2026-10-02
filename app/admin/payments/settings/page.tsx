import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { getPaymentSwitches } from '@/lib/payments/switches'
import SwitchesForm from './SwitchesForm'

// Owner-only "open payments" switches (PR105 §1). Both default OFF; turning one
// ON opens that kind of checkout to every member (the Rs 199 fee, or the paid
// plans). Changing a switch needs the owner's password and is audit-logged.

export const dynamic = 'force-dynamic'

export default async function PaymentSettingsPage() {
  await requireAdminRole(...SCREEN_ACCESS.paymentsSwitches)
  const switches = await getPaymentSwitches()

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Open payments</h1>
        <p className="text-xs text-gray-500">
          Owner only. While a switch is off, only owner, staff, seed and test accounts can pay.
          Turning it on opens that payment to every member.
        </p>
      </header>
      <SwitchesForm initial={switches} />
    </div>
  )
}
