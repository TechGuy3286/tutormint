import Link from 'next/link'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadGatewayHealth } from '@/lib/payments/gatewaySettings'
import { loadSettlement, type SettlementView } from '@/lib/settlement'
import { pkDayKey } from '@/lib/datetime'
import SettlementCheck from './SettlementCheck'

// Admin → Finance → Settlement check (moved from Payment gateways, owner,
// 8 Oct 2026). OWNER ONLY plus the view-only Partner (SCREEN_ACCESS.finance).
// Its data — gateway files, bank transfers, deduction lines — is unchanged; the
// old URLs (/admin/payments/reconciliation) redirect here.

export const dynamic = 'force-dynamic'

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export default async function SettlementPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireAdminRole(...SCREEN_ACCESS.finance)
  const sp = await searchParams
  const today = pkDayKey(new Date())
  let from = sp.from && ISO_DAY.test(sp.from) ? sp.from : `${today.slice(0, 7)}-01`
  let to = sp.to && ISO_DAY.test(sp.to) ? sp.to : today
  if (from > to) [from, to] = [to, from]

  const health = await loadGatewayHealth()
  const views: { id: string; name: string; view: SettlementView }[] = []
  for (const g of health.gateways) {
    if (!g.connected) continue
    const v = await loadSettlement(g.id, from, to)
    if (v) views.push({ id: g.id, name: g.name, view: v })
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Settlement check</h1>
        <p className="text-xs text-gray-500">
          What each gateway owes us for a date range, Pakistan time. Back to{' '}
          <Link href="/admin/finance" className="font-bold text-tm-navy hover:underline">
            Finance
          </Link>
          .
        </p>
      </header>
      {views.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-500">No payment gateway is connected.</p>
      ) : (
        views.map((v) => (
          <section key={v.id} className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
            <p className="text-sm font-bold text-tm-navy">{v.name}</p>
            <SettlementCheck view={v.view} gatewayName={v.name} />
          </section>
        ))
      )}
    </div>
  )
}
