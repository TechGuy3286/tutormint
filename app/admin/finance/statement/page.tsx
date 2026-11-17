import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadStatementBoard } from '@/lib/bankStatement'
import { loadPayproFeeAllocation } from '@/lib/payproFees'
import StatementClient from './StatementClient'

// Finance → Import bank statement (owner, 17 Nov 2026 — PR-03). OWNER ONLY,
// plus the view-only Partner (SCREEN_ACCESS.finance is []); every other role
// is redirected away. Account and mobile numbers are masked (last 4); the
// Owner may reveal one, which is logged.

export const dynamic = 'force-dynamic'

export default async function StatementPage() {
  await requireAdminRole(...SCREEN_ACCESS.finance)
  const [board, fees] = await Promise.all([loadStatementBoard(), loadPayproFeeAllocation()])
  if (!board) {
    return <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">The statement cannot be loaded right now.</p>
  }
  const settlements = (fees?.perSettlement ?? []).map((s) => ({ date: s.date, amount: s.amount, units: s.units, fee: s.fee, covered: s.covered, bankCharge: s.bankCharge }))
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="max-w-2xl text-xs text-gray-500">
          Upload the Faysal Bank account statement (.xls) exactly as the bank portal gives it. Each transaction is stored once, so a
          file that overlaps an earlier one is safe to import again. Fee credits are matched to receipts and members automatically.
        </p>
      </header>
      <StatementClient board={board} settlements={settlements} />
    </div>
  )
}
