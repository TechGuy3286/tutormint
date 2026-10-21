import { Gauge, Landmark, Scale, SlidersHorizontal } from 'lucide-react'
import Link from 'next/link'
import { permanentRedirect } from 'next/navigation'

import { requireAdminRole, roleSatisfies, SCREEN_ACCESS, roleMayWrite } from '@/lib/adminAuth'
import { loadPaymentQueue, loadSubscriptionLedger, withoutAmounts } from '@/lib/adminQueues'
import { canApprove as canApproveRole } from '@/lib/adminAccessCore'
import { createAdminClient } from '@/lib/supabase/admin'
import { legacyPaymentFilter } from '@/lib/paymentFiltersCore'
import PaymentQueue from './PaymentQueue'

// Payments: the manual-transfer approval queue and the subscription ledger.
//
// Owner, Partner (view-only), admin and operations (owner, 8 Oct 2026, item 3).
// Admin and operations see each payment's STATUS to help tutors, never an
// amount or a total: withoutAmounts() strips the rupees on the server, here and
// in the load-more route. Marking refunded is owner
// only. Owner, admin and operations approve or reject a bank-transfer receipt
// (owner, 11 Oct 2026); it additionally requires a fresh password (PR98 §4).
//
// Both lists page independently through lib/adminQueues.ts, which is also what
// the load-more route calls -- one definition of the query, so the first
// window and every window after it cannot disagree about ordering.

export const dynamic = 'force-dynamic'

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string; hidden?: string }>
}) {
  const actor = await requireAdminRole(...SCREEN_ACCESS.payments)
  // Approving a bank-transfer receipt is the Owner's alone (owner, 15 Oct
  // 2026); the decide route refuses everyone else.
  const canApprove = roleMayWrite(actor.adminRole, SCREEN_ACCESS.paymentsApprove) && canApproveRole(actor.adminRole)
  const canGateways = roleSatisfies(actor.adminRole, SCREEN_ACCESS.paymentGateways)
  const canSwitches = roleSatisfies(actor.adminRole, SCREEN_ACCESS.paymentsSwitches)
  const canReconcile = roleSatisfies(actor.adminRole, SCREEN_ACCESS.finance)
  const canRefund = roleMayWrite(actor.adminRole, SCREEN_ACCESS.paymentsRefund)
  const seesAmounts = roleSatisfies(actor.adminRole, SCREEN_ACCESS.paymentAmounts)
  const { filter: rawFilter, q = '', hidden } = await searchParams
  const search = q.trim()
  const showHidden = hidden === '1'
  // Two filters only (owner, 21 Oct 2026). The old ones (All, Bank transfer
  // receipts, Waiting, Approved, Rejected) redirect to the matching new one,
  // so a bookmark still opens; 'all' drops the filter and takes the default.
  const wanted = legacyPaymentFilter(rawFilter)
  if (rawFilter !== undefined && wanted !== rawFilter) {
    const qs = new URLSearchParams()
    if (wanted) qs.set('filter', wanted)
    if (search) qs.set('q', search)
    if (showHidden) qs.set('hidden', '1')
    const tail = qs.toString()
    permanentRedirect(tail ? `/admin/payments?${tail}` : '/admin/payments')
  }

  const admin = createAdminClient()
  if (!admin) {
    return (
      <p className="rounded-xl border border-tm-red/30 bg-tm-tint-red p-4 text-xs font-bold text-tm-red">
        SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so payments cannot be loaded.
      </p>
    )
  }

  const [payments, subscriptions] = await Promise.all([
    loadPaymentQueue({ filter: wanted ?? '', search, showHidden }),
    loadSubscriptionLedger({}),
  ])

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs text-gray-500">
          Bank and wallet transfers wait here for approval; card payments confirm on their own.
        </p>
        <div className="flex flex-wrap gap-2">
          {canGateways && (
            <Link
              href="/admin/payments/settings/gateways#bank-details"
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
              href="/admin/finance"
              className="gap-1.5 inline-flex min-h-[44px] items-center rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-slate-700"
            >
              <Scale aria-hidden size={14} />
              Settlement check
            </Link>
          )}
        </div>
      </header>

      <PaymentQueue
        payments={seesAmounts ? payments.rows : withoutAmounts(payments.rows, { keepAwaiting: canApprove })}
        canRefund={canRefund}
        subscriptions={subscriptions.rows}
        filter={payments.filter}
        counts={payments.counts}
        showHidden={showHidden}
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
