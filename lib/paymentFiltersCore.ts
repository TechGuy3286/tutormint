// lib/paymentFiltersCore.ts
//
// The Payments page's two filters (owner, 21 Oct 2026). PURE — unit-tested by
// scripts/test-payment-filters.ts and read by lib/adminQueues.ts.
//
//   Paid / Completed     every approved payment, by any method (PayPro, an
//                        approved bank receipt, a linked bank credit), never
//                        refunded.
//   Unpaid / Incomplete  everything else: started and not finished, expired,
//                        cancelled (incl. paid by another method), rejected,
//                        refunded, and bank receipts waiting for the Owner.
//
// In Unpaid, receipts waiting for approval come first (amber "Receipt waiting
// — review"); the rest follow newest first with a small grey status label.
// Rows with no member name — a deleted account, or a test account — are hidden
// unless asked for; a waiting receipt is never hidden, so nothing waits unseen.

import { paymentState } from '@/lib/paymentLabelCore'
import { receiptUnderReview } from '@/lib/payments/receiptCore'
import { STARTED_PAYMENT_CLEAR_MS } from '@/lib/startedPaymentCore'

export type PaymentFilter = 'paid' | 'unpaid'

export const PAYMENT_FILTERS: { key: PaymentFilter; label: string }[] = [
  { key: 'paid', label: 'Paid / Completed' },
  { key: 'unpaid', label: 'Unpaid / Incomplete' },
]

export const WAITING_LABEL = 'Receipt waiting — review'

export type PaymentFilterFacts = {
  status: string
  provider: string
  hasReceipt: boolean
  payerReference: string | null
  amountPkr: number | null
  refundedAmountPkr: number | null
  refundedAt?: string | null
  checkoutClosedAt: string | null
  checkoutCloseReason: string | null
  createdAt: string
  /** A member account is linked and has a name. */
  hasMember: boolean
  /** The member is a test account (hidden_from_public / is_test_name). */
  isTestAccount?: boolean
}

export type PaymentBucket = { filter: PaymentFilter; waiting: boolean; label: string }

/** Which filter a payment is in, and its status words. */
export function paymentBucket(f: PaymentFilterFacts, nowMs: number): PaymentBucket {
  const waiting = receiptUnderReview({
    status: f.status,
    provider: f.provider,
    screenshot_path: f.hasReceipt ? 'y' : null,
    reference: f.payerReference,
  })
  if (waiting) return { filter: 'unpaid', waiting: true, label: WAITING_LABEL }
  const state = paymentState(
    {
      planCode: null,
      amountPkr: f.amountPkr,
      status: f.status,
      provider: f.provider,
      createdAt: f.createdAt,
      // A receipt that is not waiting (e.g. on a PayPro row) is not a review item.
      hasReceipt: false,
      refundedAmountPkr: f.refundedAmountPkr,
      refundedAt: f.refundedAt ?? null,
      checkoutClosedAt: f.checkoutClosedAt,
      checkoutCloseReason: f.checkoutCloseReason,
    },
    nowMs,
  )
  switch (state) {
    case 'paid':
      return { filter: 'paid', waiting: false, label: 'Paid' }
    case 'refunded': {
      const partly = f.amountPkr !== null && (f.refundedAmountPkr ?? 0) > 0 && (f.refundedAmountPkr ?? 0) < f.amountPkr
      return { filter: 'unpaid', waiting: false, label: partly ? 'Partly refunded' : 'Refunded' }
    }
    case 'not_approved':
      return { filter: 'unpaid', waiting: false, label: 'Rejected' }
    case 'cancelled':
    case 'paid_another_way':
      return { filter: 'unpaid', waiting: false, label: 'Cancelled' }
    case 'expired':
      // A checkout marked closed because the member already paid or already
      // holds it is a cancellation; only the time-out reads Expired.
      return {
        filter: 'unpaid',
        waiting: false,
        label: !f.checkoutClosedAt || f.checkoutCloseReason === 'expired' ? 'Expired' : 'Cancelled',
      }
    default: {
      // A checkout never marked closed reads Expired once it is past the 48-hour
      // window in which it could still be paid (lib/startedPaymentCore).
      const age = nowMs - Date.parse(f.createdAt)
      return { filter: 'unpaid', waiting: false, label: age > STARTED_PAYMENT_CLEAR_MS ? 'Expired' : 'Started, not paid' }
    }
  }
}

/** A row with no member name: a deleted account, an unlinked old checkout, or
 *  a test account. Hidden by default; a waiting receipt is never hidden. */
export function isNamelessPayment(f: PaymentFilterFacts): boolean {
  if (paymentBucket(f, 0).waiting) return false
  return !f.hasMember || !!f.isTestAccount
}

/** Old filter keys → the new filter. `null` = no filter chosen (the default). */
export function legacyPaymentFilter(raw: string | undefined): PaymentFilter | null | undefined {
  switch (raw) {
    case undefined:
    case '':
      return undefined
    case 'paid':
    case 'unpaid':
      return raw
    case 'approved':
      return 'paid'
    case 'receipts':
    case 'pending':
    case 'rejected':
      return 'unpaid'
    case 'all':
    default:
      return null
  }
}

/** Unpaid when receipts are waiting, otherwise Paid. */
export function defaultPaymentFilter(waitingCount: number): PaymentFilter {
  return waitingCount > 0 ? 'unpaid' : 'paid'
}

export type SortableRow = { waiting: boolean; createdAt: string; id: string }

/** Waiting receipts first, then newest first (id breaks ties). */
export function sortPayments<T extends SortableRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.waiting !== b.waiting) return a.waiting ? -1 : 1
    const t = Date.parse(b.createdAt) - Date.parse(a.createdAt)
    if (t) return t
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
  })
}

/** "Payments (12)" or, while paged, "Payments — showing 25 of 40". The header
 *  and the footer read the same two numbers. */
export function paymentsHeading(shown: number, total: number): string {
  if (total === 0) return 'Payments'
  if (shown < total) return `Payments — showing ${shown} of ${total}`
  return `Payments (${total})`
}
