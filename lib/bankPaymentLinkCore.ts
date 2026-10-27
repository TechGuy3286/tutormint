// lib/bankPaymentLinkCore.ts
//
// Link a bank credit to a member (owner, 20 Oct 2026) — the pure rules.
//
// A member who sends the money straight to the company account (Raast, IBFT)
// without uploading a receipt leaves only a bank credit behind. Linking that
// credit to the member records ONE approved bank-transfer payment for them, so
// Revenue, Paid counts, the member's payment history and staff paid-sign-up
// credit all see it, on the day the money arrived. The I/O half is
// lib/bankPaymentLink.ts.
//
// No database, no clock: every rule here is unit-tested in
// scripts/test-bank-payment-link.ts.

import { pkDay } from '@/lib/settlementCore'
import { FEE_MATCH_DEFAULT, inFeeRange, partialLabel, partialShort, roundingOf, type FeeRange } from '@/lib/feeMatchCore'

/** The message a second payment for a fee the member already paid gets. */
export const ALREADY_PAID = 'This member has already paid this fee.'

/** The settlement states a credit may be linked from: not matched (automatic
 *  or by hand). An ignored credit ("not a sale") may not. */
export const LINKABLE_CREDIT_STATES = ['unmatched', 'held'] as const
export type LinkableState = (typeof LINKABLE_CREDIT_STATES)[number]

/** How a matched credit was matched — enough to tell a guess from a decision. */
export type CreditMatchFacts = { status: string; orders: string[]; receipts: string[] } | null | undefined

/**
 * A MATCHED credit may still be linked to a member when the match was the
 * automatic same-amount guess against bank-transfer receipts (owner, 21 Oct
 * 2026: Ayaz Hussain's Rs 199 credit was matched by that rule to another
 * tutor's approved receipt from two days earlier). Linking replaces the guess:
 * a manual link always wins, and the receipt it was guessed for goes back to
 * waiting for its own credit. A match made by hand, or one that pays PayPro
 * orders, is never replaced from here — unlink it first.
 */
export function autoReceiptMatch(state: string | null | undefined, match: CreditMatchFacts): boolean {
  return state === 'matched' && !!match && match.status !== 'manual' && match.orders.length === 0 && match.receipts.length > 0
}

export function creditLinkable(state: string | null | undefined, match?: CreditMatchFacts): boolean {
  return (LINKABLE_CREDIT_STATES as readonly string[]).includes(state ?? '') || autoReceiptMatch(state, match)
}

// ------------------------------------------------- the credit picker (27 Oct)

/** The largest credit "Record a bank payment" offers. A member's own payment
 *  is a fee or a monthly plan; anything bigger is a payout or something else. */
export const PICKER_MAX_PKR = 5000

export type PickerCreditFacts = {
  state: string | null | undefined
  isPaypro: boolean
  amountPkr: number
  date: string
  time: string | null
}

/**
 * May the member page's "Record a bank payment" picker offer this credit?
 * (owner, 27 Oct 2026) Only an UNLINKED credit: not matched by any rule (the
 * 21 Oct automatic-receipt-guess exception is NOT offered here — that stays on
 * the credit's own "Link to member" on Finance), not a PayPro payout, and no
 * more than Rs 5,000. An ignored ("not a sale") credit is never offered.
 */
export function pickerOffers(c: PickerCreditFacts): boolean {
  return (LINKABLE_CREDIT_STATES as readonly string[]).includes(c.state ?? '') && !c.isPaypro && c.amountPkr > 0 && c.amountPkr <= PICKER_MAX_PKR
}

/** The picker's order: credits for exactly the selected amount on top, then
 *  newest first (date, then time). */
export function sortPickerCredits<T extends Pick<PickerCreditFacts, 'amountPkr' | 'date' | 'time'>>(credits: T[], selectedAmount: number | null | undefined): T[] {
  const sel = selectedAmount && selectedAmount > 0 ? selectedAmount : null
  const hit = (c: T) => (sel !== null && Math.abs(c.amountPkr - sel) < 0.005 ? 1 : 0)
  return [...credits].sort((a, b) => hit(b) - hit(a) || b.date.localeCompare(a.date) || (b.time ?? '').localeCompare(a.time ?? ''))
}

/** The one rule: filter, then order. */
export function pickerCredits<T extends PickerCreditFacts>(credits: T[], selectedAmount: number | null | undefined): T[] {
  return sortPickerCredits(credits.filter(pickerOffers), selectedAmount)
}

/**
 * The instant the money arrived, from the bank credit's date and time (both
 * Pakistan time). No time recorded → noon that day, so the payment still falls
 * on the credit's own date in every Pakistan-time count.
 */
export function creditPaidAt(date: string, time: string | null | undefined): string {
  const hhmm = time && /^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : '12:00'
  return new Date(`${date}T${hhmm}:00+05:00`).toISOString()
}

export type LinkPlan = { code: string; name: string; audience: string; pricePkr: number; active: boolean }

export type ExistingPayment = {
  id: string
  planCode: string | null
  status: string
  refundedAmountPkr?: number | null
  refundedAt?: string | null
}

export type ExistingSub = { id: string; planCode: string; status: string; paymentId: string | null }

export type LinkFacts = {
  memberRole: string | null
  /** tutor_profiles.verified_fee_paid_at — set by a payment OR a manual grant. */
  feePaidAt: string | null
  plan: LinkPlan | null
  payments: ExistingPayment[]
  /** The member's active or paused subscriptions. */
  subs: ExistingSub[]
  creditState: string | null
  /** The credit's current match (automatic or by hand), if any. */
  creditMatch?: CreditMatchFacts
  creditAmountPkr: number
  amountPkr: number
  /** The Fee match range (owner, 27 Oct 2026); the default when not given. */
  feeRange?: FeeRange
}

/**
 * What linking will do:
 *   activate — nothing is held yet: the payment is approved through the same
 *              activation a gateway or an approved receipt runs.
 *   attach   — a manual grant already gave the badge / plan: the payment is
 *              approved and attached to it. Nothing is granted again and no
 *              plan is extended.
 */
export type LinkDecision =
  | { ok: true; mode: 'activate' }
  | { ok: true; mode: 'attach'; subscriptionId: string | null }
  | { ok: false; error: string }

const counted = (p: ExistingPayment) => p.status === 'approved' && !((Number(p.refundedAmountPkr) || 0) > 0 || p.refundedAt)

export function linkDecision(f: LinkFacts): LinkDecision {
  if (!creditLinkable(f.creditState, f.creditMatch)) {
    return { ok: false, error: f.creditState === 'ignored' ? 'This bank credit is marked "not a sale". Put it back to automatic first.' : 'This bank credit is already matched by hand or to PayPro orders. Unlink it first.' }
  }
  if (f.memberRole !== 'tutor' && f.memberRole !== 'parent') return { ok: false, error: 'Choose a tutor or parent account.' }
  const plan = f.plan
  if (!plan || !plan.active || !(plan.pricePkr > 0)) return { ok: false, error: 'Choose what this payment was for.' }
  if (plan.audience !== f.memberRole) return { ok: false, error: `${plan.name} is a ${plan.audience} plan; this account is a ${f.memberRole}.` }
  if (!(f.amountPkr > 0)) return { ok: false, error: 'Enter the amount.' }
  if (f.amountPkr > f.creditAmountPkr + 0.005) return { ok: false, error: 'The amount cannot be more than the bank credit.' }

  if (plan.code === 'verified') {
    // A credit below the fee match range is a partial payment: never activated.
    const range = f.feeRange ?? FEE_MATCH_DEFAULT
    const short = partialShort(Math.min(f.creditAmountPkr, f.amountPkr), range, plan.pricePkr)
    if (short !== null) return { ok: false, error: `${partialLabel(short)}. A partial payment never activates the Verification Fee.` }
    if (f.payments.some((p) => p.planCode === 'verified' && counted(p))) return { ok: false, error: ALREADY_PAID }
    return f.feePaidAt ? { ok: true, mode: 'attach', subscriptionId: null } : { ok: true, mode: 'activate' }
  }

  // A plan. The current period already paid for → a second payment would be
  // counted twice. A period given by a manual grant (no payment) → attach.
  const current = f.subs.find((s) => s.planCode === plan.code && (s.status === 'active' || s.status === 'paused'))
  if (current) {
    const paidBy = current.paymentId ? f.payments.find((p) => p.id === current.paymentId) : null
    if (paidBy && counted(paidBy)) return { ok: false, error: ALREADY_PAID }
    return { ok: true, mode: 'attach', subscriptionId: current.id }
  }
  if (f.memberRole === 'tutor' && !f.feePaidAt) return { ok: false, error: `${plan.name} is for verified tutors. Record the Verification Fee first.` }
  return { ok: true, mode: 'activate' }
}

/** The payment row a link inserts (pending; the activation or the attach step
 *  approves it). Method "Bank transfer" (payments.method 'bank'), the bank's
 *  own reference, and a note naming the credit. */
export function bankPaymentRow(input: {
  userId: string
  planCode: string
  amountPkr: number
  /** The extra above the price a fee-range credit carried (27 Oct 2026). */
  roundingPkr?: number | null
  providerRef: string
  bankReference: string | null
  creditId: string
  creditDate: string
}) {
  return {
    user_id: input.userId,
    plan_code: input.planCode,
    amount_pkr: Math.round(input.amountPkr * 100) / 100,
    rounding_pkr: input.roundingPkr && input.roundingPkr > 0 ? input.roundingPkr : null,
    status: 'pending',
    provider: 'manual',
    method: 'bank',
    provider_ref: input.providerRef,
    reference: input.bankReference ? input.bankReference.slice(0, 80) : null,
    note: `Bank credit of ${input.creditDate}, linked by the Owner`,
    raw: { bankTransferId: input.creditId },
  }
}

/** The day a linked payment counts on (Pakistan time). */
export function countsOnDay(paidAtIso: string): string {
  return pkDay(paidAtIso)
}

/**
 * What a fee payment from a credit records (owner, 27 Oct 2026): an amount in
 * the Fee match range is the fee's price plus 'rounding' (Rs 200 → Rs 199 +
 * Rs 1). Any other plan, or an amount outside the range, records as typed.
 */
export function feeAmountSplit(planCode: string, amount: number, price: number, range: FeeRange = FEE_MATCH_DEFAULT): { amountPkr: number; roundingPkr: number } {
  if (planCode === 'verified' && price > 0 && inFeeRange(amount, range) && amount >= price) return { amountPkr: price, roundingPkr: roundingOf(amount, price) }
  return { amountPkr: Math.round(amount * 100) / 100, roundingPkr: 0 }
}
