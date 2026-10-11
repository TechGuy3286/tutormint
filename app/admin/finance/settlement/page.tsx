import Link from 'next/link'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadGatewayHealth } from '@/lib/payments/gatewaySettings'
import { loadSettlement, type SettlementView } from '@/lib/settlement'
import { loadSettlementsBoard } from '@/lib/settlementMatch'
import { pkDayKey } from '@/lib/datetime'
import SettlementCheck from './SettlementCheck'
import SettlementsBoard from './SettlementsBoard'

// Admin → Finance → Settlement check. OWNER ONLY plus the view-only Partner
// (SCREEN_ACCESS.finance).
//
// Two parts, on the same data (gateway files, bank credits, deduction lines):
//   • Settlements (owner, 11 Oct 2026) — one month: PayPro payouts and approved
//     bank transfers matched to the bank credits, with what needs attention.
//   • The range check and deduction lines per gateway (6–8 Oct 2026), unchanged,
//     folded under it.
// The old URLs (/admin/payments/reconciliation) redirect here.

export const dynamic = 'force-dynamic'

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

export default async function SettlementPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; month?: string }> }) {
  await requireAdminRole(...SCREEN_ACCESS.finance)
  const sp = await searchParams
  const today = pkDayKey(new Date())
  const month = sp.month && ISO_MONTH.test(sp.month) ? sp.month : today.slice(0, 7)
  const ranged = !!(sp.from && ISO_DAY.test(sp.from) && sp.to && ISO_DAY.test(sp.to))
  let from = sp.from && ISO_DAY.test(sp.from) ? sp.from : `${today.slice(0, 7)}-01`
  let to = sp.to && ISO_DAY.test(sp.to) ? sp.to : today
  if (from > to) [from, to] = [to, from]

  const [board, health] = await Promise.all([loadSettlementsBoard(month), loadGatewayHealth()])
  const views: { id: string; name: string; view: SettlementView }[] = []
  for (const g of health.gateways) {
    if (!g.connected) continue
    const v = await loadSettlement(g.id, from, to)
    if (v) views.push({ id: g.id, name: g.name, view: v })
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-black text-tm-navy">Settlement check</h1>
        <p className="text-xs text-gray-500">
          What customers paid, and what has reached the bank: PayPro payouts and approved bank transfers matched to your bank credits, Pakistan time. Back to{' '}
          <Link href="/admin/finance" className="font-bold text-tm-navy hover:underline">
            Finance
          </Link>
          .
        </p>
      </header>

      {board ? (
        <SettlementsBoard key={month} data={board} />
      ) : (
        <p className="rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-500">Settlements could not be loaded right now. Please reload the page.</p>
      )}

      <details open={ranged} className="rounded-2xl border border-gray-200 bg-white p-4">
        <summary className="min-h-[44px] cursor-pointer text-sm font-bold text-tm-navy">Range check and deduction lines</summary>
        <div className="mx-auto max-w-xl space-y-6 pt-3">
          {views.length === 0 ? (
            <p className="text-xs text-gray-500">No payment gateway is connected.</p>
          ) : (
            views.map((v) => (
              <section key={v.id} className="space-y-2">
                <p className="text-sm font-bold text-tm-navy">{v.name}</p>
                <SettlementCheck view={v.view} gatewayName={v.name} />
              </section>
            ))
          )}
        </div>
      </details>
    </div>
  )
}
