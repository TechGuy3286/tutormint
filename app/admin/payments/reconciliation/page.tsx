import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { pkDayKey } from '@/lib/datetime'
import { loadReconciliation } from '@/lib/reconciliation'
import ReconciliationClient from './ReconciliationClient'

// PayPro reconciliation (owner, 6 Oct 2026). owner + admin only — the same
// people who approve payments. The screen compares PayPro's Orders export with
// our payments and the bank, and reports; it never changes a payment.

export const dynamic = 'force-dynamic'

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** The current Pakistan-time month: first day to last day. */
function currentMonth(): { from: string; to: string } {
  const today = pkDayKey(new Date()) // YYYY-MM-DD in Asia/Karachi
  const [y, m] = today.split('-').map(Number)
  const from = `${today.slice(0, 7)}-01`
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from, to: `${today.slice(0, 7)}-${String(lastDay).padStart(2, '0')}` }
}

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  await requireAdminRole(...SCREEN_ACCESS.reconciliation)

  const sp = await searchParams
  const month = currentMonth()
  let from = sp.from && ISO_DAY.test(sp.from) ? sp.from : month.from
  let to = sp.to && ISO_DAY.test(sp.to) ? sp.to : month.to
  if (from > to) [from, to] = [to, from]

  const view = await loadReconciliation({ from, to })

  if (!view) {
    return (
      <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so reconciliation cannot be loaded.
      </p>
    )
  }

  return <ReconciliationClient view={view} />
}
