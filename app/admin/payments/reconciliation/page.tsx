import { permanentRedirect } from 'next/navigation'

// Reconciliation moved into Admin → Settings → Payment gateways → Settlement
// check (owner, 6 Oct 2026). The old URL redirects there; its saved imports and
// bank transfers are kept and read by the settlement check.

export const dynamic = 'force-dynamic'

export default async function ReconciliationMoved({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const sp = await searchParams
  const day = /^\d{4}-\d{2}-\d{2}$/
  const q = sp.from && sp.to && day.test(sp.from) && day.test(sp.to) ? `?from=${sp.from}&to=${sp.to}` : ''
  permanentRedirect(`/admin/payments/settings/gateways${q}`)
}
