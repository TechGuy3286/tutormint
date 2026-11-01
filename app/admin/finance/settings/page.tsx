import { permanentRedirect } from 'next/navigation'

import { paymentSettingsHref } from '@/lib/paymentSettingsCore'

// Finance → Settings was merged into Payments → Settings (owner, 31 Oct 2026).
// Its components (ReaderSwitch, FinanceSettingsView, FeeRangeForm) stay in this
// folder and are rendered by the merged page.

export default function FinanceSettingsPage() {
  permanentRedirect(paymentSettingsHref('fee-match-and-reader'))
}
