// lib/payments/payproVerify.ts
//
// THE one rule for "is this PayPro order genuinely paid for OUR price?" (PR104).
// Pure, no imports, so the callback, the return page, the reconcile cron and the
// tests all read the same decision — the bug in PR103 was three copies of a
// too-strict guard (|OrderAmountPaid − price| < 1) that rejected every paid
// order, because PayPro reports the fee-inclusive amount the customer paid.
//
// A PayPro order is accepted ONLY when ALL hold:
//   1. OrderStatus === 'PAID'
//   2. the order number PayPro echoes matches OUR provider_ref (right order)
//   3. the BILL PayPro holds (AmountPayable) equals our price — we must not
//      activate an order created for a different amount
//   4. the amount the customer PAID is at least our price (a gateway fee ON TOP
//      is fine; paying LESS is not)
//
// amount_pkr stays our price (199); what PayPro reports is recorded separately
// for finance.

export type PayproOrderFacts = {
  orderStatus: string | null | undefined
  /** AmountPayable — the bill PayPro holds for the order. */
  amountPayable: number | null | undefined
  /** OrderAmountPaid — what the customer actually paid (may include the fee). */
  amountPaid: number | null | undefined
  /** OrderNumber PayPro echoes back. */
  orderNumber: string | null | undefined
}

export type PayproAcceptResult =
  | { accepted: true }
  | { accepted: false; reason: 'not_paid' | 'wrong_order' | 'bill_mismatch' | 'underpaid' }

// A rupee of slack absorbs rounding; it never spans the Rs 7 fee.
const EPS = 1

export function payproOrderAccepted(
  facts: PayproOrderFacts,
  expected: { ourPrice: number; ourRef: string },
): PayproAcceptResult {
  if (String(facts.orderStatus ?? '').toUpperCase() !== 'PAID') {
    return { accepted: false, reason: 'not_paid' }
  }
  // The order number must be ours. PayPro may omit it in ggos; only REJECT on a
  // present-and-different value, never on a missing one.
  const echoed = String(facts.orderNumber ?? '').trim()
  if (echoed && echoed !== expected.ourRef) {
    return { accepted: false, reason: 'wrong_order' }
  }
  const payable = Number(facts.amountPayable ?? 0)
  const paid = Number(facts.amountPaid ?? 0)
  // The order must have been billed for OUR price.
  if (Math.abs(payable - expected.ourPrice) > EPS) {
    return { accepted: false, reason: 'bill_mismatch' }
  }
  // The customer must have paid at least our price (fee on top is fine).
  if (paid < expected.ourPrice - EPS) {
    return { accepted: false, reason: 'underpaid' }
  }
  return { accepted: true }
}
