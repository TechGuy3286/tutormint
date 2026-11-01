import { permanentRedirect } from 'next/navigation'

import { paymentSettingsHref } from '@/lib/paymentSettingsCore'

// The bank transfer details live on Payments → Settings (owner, 31 Oct 2026).
// The form itself (BankDetailsForm) still lives in this folder and is rendered
// by that page.

export default function BankDetailsPage() {
  permanentRedirect(paymentSettingsHref('bank-transfer'))
}
