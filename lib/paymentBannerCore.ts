// lib/paymentBannerCore.ts
//
// PURE. The "payment started, not finished" banner on /membership-plans
// (owner, 17 Oct 2026). It replaces "You have a payment in progress — tap to
// continue", which showed the member's newest pending payment of any kind: an
// old Verification Fee checkout on a tutor who had long since paid it, a
// checkout from weeks ago, a row with no plan. Tapping it led to /pay/return,
// which sent a paid member straight to the dashboard — nothing to continue.
//
// The banner now shows only a checkout that can still be paid:
//   • pending, not closed (cancelled or expired — see checkout_closed_at),
//     no receipt attached, not refunded;
//   • for a plan that exists for the member's audience;
//   • not something the member already has (the Verification Fee on a tutor
//     whose fee is stamped; the plan they hold now) and not paid since;
//   • opened in the last 48 hours — the same window as Overview's "Started
//     payment, didn't finish" (STARTED_PAYMENT_CLEAR_MS).
// A bank-transfer receipt waiting for the Owner's approval shows a different
// message with no continue link. Nothing here writes; a checkout is closed by
// marking it (lib/paymentBanner), never deleted, and never one that is
// approved, refunded or carries a receipt (`closable`).

import { STARTED_PAYMENT_CLEAR_MS } from '@/lib/startedPaymentCore'

export const CHECKOUT_WINDOW_MS = STARTED_PAYMENT_CLEAR_MS

/** Why a checkout was closed. Stored in payments.checkout_close_reason. */
export type CloseReason = 'cancelled_by_member' | 'expired' | 'already_paid' | 'already_has_it' | 'no_valid_checkout'

export const CLOSE_REASONS: readonly CloseReason[] = [
  'cancelled_by_member',
  'expired',
  'already_paid',
  'already_has_it',
  'no_valid_checkout',
]

export type BannerPayment = {
  id: string
  planCode: string | null
  status: string
  createdAt: string
  provider: string | null
  providerRef: string | null
  /** A receipt file or a bank reference was sent. */
  hasReceipt: boolean
  refundedAt?: string | null
  closedAt?: string | null
}

export type BannerPlan = { code: string; name: string; audience: string; pricePkr: number }

export type Holdings = {
  audience: 'tutor' | 'parent'
  /** The tutor's Verification Fee is stamped. */
  feePaid: boolean
  /** Plan codes held now (an active subscription). */
  activePlans: string[]
  /** Approved, not refunded payments. */
  approved: { planCode: string; at: string }[]
}

export type CheckoutProblem =
  | 'not_pending'
  | 'closed'
  | 'receipt'
  | 'refunded'
  | 'no_valid_checkout'
  | 'already_paid'
  | 'already_has_it'
  | 'too_old'

/** Why this checkout must NOT be offered as "continue paying" — null = it can be. */
export function checkoutProblem(
  p: BannerPayment,
  h: Holdings,
  plans: Map<string, BannerPlan>,
  nowMs: number,
): CheckoutProblem | null {
  if (p.status !== 'pending') return 'not_pending'
  if (p.closedAt) return 'closed'
  if (p.refundedAt) return 'refunded'
  if (p.hasReceipt) return 'receipt'
  const plan = p.planCode ? plans.get(p.planCode) : undefined
  if (!plan || plan.audience !== h.audience || !(plan.pricePkr > 0) || !p.providerRef) return 'no_valid_checkout'
  const t = Date.parse(p.createdAt)
  if (!Number.isFinite(t)) return 'no_valid_checkout'
  if (h.approved.some((a) => a.planCode === plan.code && Date.parse(a.at) >= t)) return 'already_paid'
  if (plan.code === 'verified' && h.feePaid) return 'already_has_it'
  if (h.activePlans.includes(plan.code)) return 'already_has_it'
  if (nowMs - t > CHECKOUT_WINDOW_MS) return 'too_old'
  return null
}

/** The stored close reason for a problem the clean-up acts on (null = leave it). */
export function closeReasonFor(problem: CheckoutProblem | null): CloseReason | null {
  switch (problem) {
    case 'already_paid':
      return 'already_paid'
    case 'already_has_it':
      return 'already_has_it'
    case 'too_old':
      return 'expired'
    case 'no_valid_checkout':
      return 'no_valid_checkout'
    default:
      return null
  }
}

/** May this row be marked closed at all? Never an approved, rejected or
 *  refunded payment, and never a receipt waiting for approval. */
export function closable(p: Pick<BannerPayment, 'status' | 'hasReceipt' | 'refundedAt'>): boolean {
  return p.status === 'pending' && !p.hasReceipt && !p.refundedAt
}

export type Banner =
  | { kind: 'receipt'; planCode: string; label: string }
  | { kind: 'checkout'; paymentId: string; planCode: string; label: string; pricePkr: number; continueHref: string }

/** The package name the member sees ("Verification Fee", "Premium"). */
export function packageLabel(plan: BannerPlan, feeLabel: string): string {
  return plan.code === 'verified' ? feeLabel : plan.name
}

/** Where Continue goes: the payment choice screen for that exact plan. */
export function continueHref(planCode: string): string {
  return `/pay/choose?plan=${encodeURIComponent(planCode)}`
}

/** "Premium — Rs 499: payment started, not finished." */
export function checkoutLine(label: string, pricePkr: number): string {
  return `${label} — Rs ${String(Math.round(pricePkr)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}: payment started, not finished.`
}

export const RECEIPT_LINE = 'Receipt received — we’re checking it.'

/** The one banner for a member, or null. A waiting receipt wins over a checkout
 *  (the member has paid; they must not be asked to pay again). */
export function bannerFor(
  rows: BannerPayment[],
  h: Holdings,
  plans: Map<string, BannerPlan>,
  nowMs: number,
  feeLabel: string,
): Banner | null {
  const newest = [...rows].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  for (const p of newest) {
    if (p.status !== 'pending' || p.closedAt || p.refundedAt || !p.hasReceipt) continue
    const plan = p.planCode ? plans.get(p.planCode) : undefined
    if (!plan || plan.audience !== h.audience) continue
    return { kind: 'receipt', planCode: plan.code, label: packageLabel(plan, feeLabel) }
  }
  for (const p of newest) {
    if (checkoutProblem(p, h, plans, nowMs) !== null) continue
    const plan = plans.get(p.planCode as string) as BannerPlan
    return {
      kind: 'checkout',
      paymentId: p.id,
      planCode: plan.code,
      label: packageLabel(plan, feeLabel),
      pricePkr: plan.pricePkr,
      continueHref: continueHref(plan.code),
    }
  }
  return null
}
