// lib/paymentLabelCore.ts
//
// One payment row in plain words (owner, 20 Oct 2026) — the admin member page
// read "Verified — Rs. 199 · pending · paypro", which looked as if the tutor
// were verified. Now:
//
//   Verification Fee Rs 199 — started, not paid    a checkout over 1 hour old
//   Verification Fee Rs 199 — paid                  approved
//   Verification Fee Rs 199 — receipt waiting       a bank receipt to check
//   Verification Fee Rs 199 — refunded              any refund recorded
//   Verification Fee Rs 199 — cancelled / expired   a checkout marked closed
//
// Plan names are the same everywhere: Verification Fee, Premium, Featured,
// Parent Verified, Parent Featured. The amount is left out for a viewer who may
// not see amounts. PURE — unit-tested by scripts/test-admin-cleanup.ts.

import { FEE_LABEL } from '@/lib/display'
import { STARTED_PAYMENT_MIN_MS } from '@/lib/startedPaymentCore'

export const PAYMENT_PLAN_NAME: Record<string, string> = {
  verified: FEE_LABEL,
  basic: 'Basic',
  premium: 'Premium',
  featured: 'Featured',
  parent_verified: 'Parent Verified',
  parent_featured: 'Parent Featured',
}

export function paymentPlanName(code: string | null | undefined): string {
  if (!code) return 'Payment'
  return (
    PAYMENT_PLAN_NAME[code] ??
    code
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(' ')
  )
}

export type PaymentState = 'paid' | 'refunded' | 'receipt_waiting' | 'cancelled' | 'expired' | 'started_not_paid' | 'in_progress' | 'not_approved'

export const PAYMENT_STATE_WORDS: Record<PaymentState, string> = {
  paid: 'paid',
  refunded: 'refunded',
  receipt_waiting: 'receipt waiting',
  cancelled: 'cancelled',
  expired: 'expired',
  started_not_paid: 'started, not paid',
  in_progress: 'started just now',
  not_approved: 'not approved',
}

export type PaymentFacts = {
  planCode: string | null
  amountPkr: number | null
  status: string
  provider: string | null
  createdAt: string
  /** A bank receipt or reference was sent. */
  hasReceipt: boolean
  refundedAmountPkr?: number | null
  refundedAt?: string | null
  checkoutClosedAt?: string | null
  checkoutCloseReason?: string | null
}

export function paymentState(p: PaymentFacts, nowMs: number): PaymentState {
  if ((p.refundedAmountPkr ?? 0) > 0 || p.refundedAt) return 'refunded'
  if (p.status === 'approved') return 'paid'
  if (p.status === 'rejected') return 'not_approved'
  if (p.hasReceipt) return 'receipt_waiting'
  if (p.checkoutClosedAt) return p.checkoutCloseReason === 'cancelled_by_member' ? 'cancelled' : 'expired'
  const t = Date.parse(p.createdAt)
  if (Number.isFinite(t) && nowMs - t > STARTED_PAYMENT_MIN_MS) return 'started_not_paid'
  return 'in_progress'
}

/** "Verification Fee Rs 199 — started, not paid". */
export function paymentLabel(p: PaymentFacts, nowMs: number, opts: { showAmount: boolean }): string {
  const name = paymentPlanName(p.planCode)
  const amount = opts.showAmount && typeof p.amountPkr === 'number' ? ` Rs ${p.amountPkr.toLocaleString('en-PK')}` : ''
  return `${name}${amount} — ${PAYMENT_STATE_WORDS[paymentState(p, nowMs)]}`
}

/** A WhatsApp follow-up (the payment_not_finished message) fits this row. */
export function paymentNeedsFollowUp(p: PaymentFacts, nowMs: number): boolean {
  return paymentState(p, nowMs) === 'started_not_paid'
}
