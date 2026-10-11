import { permanentRedirect } from 'next/navigation'

// The bank transfer details moved to Admin → Settings → Payment gateways (owner,
// 11 Oct 2026), beside the "Show bank transfer to members" switch: they are
// shown to members on the payment choice screen, so entering them is owner only.
// The form itself (BankDetailsForm, AlertEmailsForm) still lives in this folder
// and is rendered by that page.

export default function BankDetailsPage() {
  permanentRedirect('/admin/payments/settings/gateways#bank-details')
}
