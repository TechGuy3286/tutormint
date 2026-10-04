import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { SETTING_KEYS } from '@/lib/payments/manual'
import { PAYMENT_ALERTS_KEY } from '@/lib/payments/paymentAlerts'
import BankDetailsForm from './BankDetailsForm'
import AlertEmailsForm from './AlertEmailsForm'

// Edit the bank-transfer details members pay into (PR98 §4).
//
// owner / admin only. The values are stored in app_settings and read by
// lib/payments/manual; this screen is the no-deploy way to change them. The QR
// image (optional) is stored privately and shown only on checkout.

export const dynamic = 'force-dynamic'

export default async function BankDetailsPage() {
  const actor = await requireAdminRole(...SCREEN_ACCESS.paymentsSettings)
  const isOwner = actor.adminRole === 'owner'

  const admin = createAdminClient()
  const stored = new Map<string, string>()
  if (admin) {
    const { data } = await admin
      .from('app_settings')
      .select('key, value')
      .in('key', [...Object.values(SETTING_KEYS), PAYMENT_ALERTS_KEY])
    for (const r of data ?? []) stored.set(r.key as string, (r.value as string) ?? '')
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Bank transfer details</h1>
        <p className="text-xs text-gray-500">
          These are shown on the checkout bank-transfer option. Members quote their own order
          reference when they send money. Changing these needs your password.
        </p>
      </header>

      <BankDetailsForm
        initial={{
          accountTitle: stored.get(SETTING_KEYS.accountTitle) ?? '',
          bankName: stored.get(SETTING_KEYS.bankName) ?? '',
          bankBranch: stored.get(SETTING_KEYS.bankBranch) ?? '',
          accountNumber: stored.get(SETTING_KEYS.accountNumber) ?? '',
          iban: stored.get(SETTING_KEYS.iban) ?? '',
          hasQr: !!(stored.get(SETTING_KEYS.qrPath) ?? ''),
        }}
      />

      {/* PR106-H1 §2: owner-only "Payment alert emails". */}
      {isOwner && <AlertEmailsForm initial={stored.get(PAYMENT_ALERTS_KEY) ?? 'techguy3286@gmail.com'} />}
    </div>
  )
}
