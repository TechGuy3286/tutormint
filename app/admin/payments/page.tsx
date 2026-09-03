import Link from 'next/link'

import { requireAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadPaymentQueue, loadSubscriptionLedger } from '@/lib/adminQueues'
import { createAdminClient } from '@/lib/supabase/admin'
import PaymentQueue from './PaymentQueue'

// Payments: the manual-transfer queue and the subscription ledger.
//
// owner / manager / finance. A verifier or support admin is bounced by
// requireAdminRole here and by checkAdminRole in the decide route, so the
// separation holds whether they use the screen or curl.
//
// Both lists page independently through lib/adminQueues.ts, which is also what
// the load-more route calls -- one definition of the query, so the first
// window and every window after it cannot disagree about ordering.

export const dynamic = 'force-dynamic'

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  await requireAdminRole(...SCREEN_ACCESS.payments)
  const { filter = 'pending' } = await searchParams

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so payments cannot be loaded.
      </p>
    )
  }

  const [payments, subscriptions] = await Promise.all([
    loadPaymentQueue({ filter }),
    loadSubscriptionLedger({}),
  ])

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs text-gray-500">
          Approving a transfer runs exactly the same activation a gateway webhook runs.
        </p>
        <Link
          href="/admin/payments/usage"
          className="inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700"
        >
          Quota usage
        </Link>
      </header>

      <PaymentQueue
        payments={payments.rows}
        subscriptions={subscriptions.rows}
        filter={filter}
        paymentsCursor={payments.nextCursor}
        paymentsTotal={payments.total}
        subscriptionsCursor={subscriptions.nextCursor}
        subscriptionsTotal={subscriptions.total}
      />
    </div>
  )
}
