// lib/payments/refundCore.ts
//
// PURE refund rules (no server imports) so the amount/state logic is unit-tested
// and shared by the admin form, the server route and the dashboard section.

export const REFUND_METHODS = ['PayPro', 'JazzCash', 'Easypaisa', 'Bank'] as const
export type RefundMethod = (typeof REFUND_METHODS)[number]

export const REFUND_REASONS = [
  'Duplicate payment',
  'Paid by mistake',
  'Service not used',
  'Requested by member',
  'Other',
] as const

export type RefundState = 'none' | 'partly' | 'full'

/** Full / partial / none, from the payment amount and the TOTAL refunded. */
export function refundState(amountPkr: number, refundedPkr: number | null | undefined): RefundState {
  const r = refundedPkr ?? 0
  if (r <= 0) return 'none'
  if (r >= amountPkr) return 'full'
  return 'partly'
}

/** The word shown in Admin → Payments and the dashboard. */
export function refundLabel(state: RefundState): string {
  return state === 'full' ? 'Refunded' : state === 'partly' ? 'Partly refunded' : ''
}

/** Validate a requested refund against the payment. `alreadyRefunded` is the
 *  total already refunded on the row; the new amount cannot take the total over
 *  the payment amount. An absent request defaults to the full remaining amount. */
export function resolveRefundAmount(
  requested: number | null | undefined,
  amountPkr: number,
  alreadyRefunded: number,
): { ok: true; amount: number } | { ok: false; error: string } {
  const remaining = amountPkr - (alreadyRefunded ?? 0)
  if (remaining <= 0) return { ok: false, error: 'This payment is already fully refunded.' }
  const amount = requested == null ? remaining : Math.round(requested)
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter a refund amount.' }
  if (amount > remaining) return { ok: false, error: `The most you can refund is Rs ${remaining.toLocaleString('en-PK')}.` }
  return { ok: true, amount }
}
