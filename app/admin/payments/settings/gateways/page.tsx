import { permanentRedirect } from 'next/navigation'

import { paymentSettingsHref } from '@/lib/paymentSettingsCore'

// Payment gateways was merged into Payments → Settings (owner, 31 Oct 2026).
// An old settlement-check link (it carried ?from&to) still goes to Finance.
// GatewaysClient stays in this folder and is rendered by the merged page.

export default async function PaymentGatewaysPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams
  if (sp.from || sp.to) {
    const q = new URLSearchParams()
    if (sp.from) q.set('from', sp.from)
    if (sp.to) q.set('to', sp.to)
    q.set('tab', 'settlement')
    permanentRedirect(`/admin/finance?${q.toString()}`)
  }
  permanentRedirect(paymentSettingsHref('bank-transfer'))
}
