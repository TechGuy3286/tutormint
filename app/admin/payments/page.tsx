import { Gauge, Landmark, Scale, SlidersHorizontal } from 'lucide-react'
import Link from 'next/link'

import { requireAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadPaymentQueue, loadSubscriptionLedger, withoutAmounts } from '@/lib/adminQueues'
import { createAdminClient } from '@/lib/supabase/admin'
import PaymentQueue from './PaymentQueue'

// Payments: the manual-transfer approval queue and the subscription ledger.
//
// Owner, Partner (view-only), admin and operations (owner, 8 Oct 2026, item 3).
// Admin and operations see each payment's STATUS to help tutors, never an
// amount or a total: withoutAmounts() strips the rupees on the server, here and
// in the load-more route. Approving stays admin; marking refunded is owner
// only. Approving a transfer additionally requires a fresh password (PR98 §4).
//
// Both lists page independently through lib/adminQueues.ts, which is also what
// the load-more route calls -- one definition of the query, so the first
// window and every window after it cannot disagree about ordering.

export const dynamic = 'force-dynamic'

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>
}) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.payments)
  const canApprove = roleSatisfies(actor.adminRole, SCREEN_ACCESS.paymentsApprove)
  const canSettings = roleSatisfies(actor.adminRole, SCREEN_ACCESS.paymentsSettings)
  const canSwitches = roleSatisfies(actor.adminRole, SCREEN_ACCESS.paymentsSwitches)
  const canReconcile = roleSatisfies(actor.adminRole, SCREEN_ACCESS.finance)
  const canRefund = roleSatisfies(actor.adminRole, SCREEN_ACCESS.paymentsRefund)
  const seesAmounts = roleSatisfies(actor.adminRole, SCREEN_ACCESS.paymentAmounts)
  const { filter = 'all', q = '' } = await searchParams
  const search = q.trim()

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so payments cannot be loaded.
      </p>
    )
  }

  const [payments, subscriptions] = await Promise.all([
    loadPaymentQueue({ filter, search }),
    loadSubscriptionLedger({}),
  ])

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs text-gray-500">
          Bank and wallet transfers wait here for approval; card payments confirm on their own.
        </p>
        <div className="flex flex-wrap gap-2">
          {canSettings && (
            <Link
              href="/admin/payments/bank-details"
              className="gap-1.5 inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700"
            >
              <Landmark aria-hidden size={14} />
              Bank transfer details
            </Link>
          )}
          {canSwitches && (
            <Link
              href="/admin/payments/settings"
              className="gap-1.5 inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700"
            >
              <SlidersHorizontal aria-hidden size={14} />
              Settings
            </Link>
          )}
          <Link
            href="/admin/payments/usage"
            className="gap-1.5 inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700"
          >
            <Gauge aria-hidden size={14} />
            Quota usage
          </Link>
          {canReconcile && (
            <Link
              href="/admin/finance/settlement"
              className="gap-1.5 inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700"
            >
              <Scale aria-hidden size={14} />
              Settlement check
            </Link>
          )}
        </div>
      </header>

      <PaymentQueue
        payments={seesAmounts ? payments.rows : withoutAmounts(payments.rows)}
        canRefund={canRefund}
        subscriptions={subscriptions.rows}
        filter={filter}
        search={search}
        canApprove={canApprove}
        paymentsCursor={payments.nextCursor}
        paymentsTotal={payments.total}
        subscriptionsCursor={subscriptions.nextCursor}
        subscriptionsTotal={subscriptions.total}
      />
    </div>
  )
}
