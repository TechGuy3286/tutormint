// lib/payments/closeOtherCheckoutsCore.ts
//
// Paid by another method (owner, 21 Oct 2026) — the pure rule. Once a member's
// Verification Fee or plan is paid (PayPro, an approved bank receipt, a bank
// credit linked by the Owner), their OTHER open checkouts for the same thing
// are marked closed with the reason "Paid by another method", so Follow-ups,
// the payment banner and the member page stop treating them as started and not
// paid. Ayaz Hussain's PayPro "started, not paid" next to a fee paid by Raast
// is the case it fixes.
//
// A closed checkout keeps its status (pending) and nothing is deleted, as for
// every close reason (migration 185): a late PayPro payment still activates.
// A checkout with a receipt or a typed reference is NEVER closed here — a
// person sent proof of payment and staff decide on it.
//
// I/O: lib/payments/closeOtherCheckouts.ts. Tested in
// scripts/test-approve-bank-credit.ts.

/** Stored in payments.checkout_close_reason (CHECK widened by migration 189). */
export const PAID_ANOTHER_WAY = 'paid_another_way'
export const PAID_ANOTHER_WAY_WORDS = 'Paid by another method'

export type OpenCheckoutRow = {
  id: string
  planCode: string | null
  status: string
  provider: string | null
  hasScreenshot: boolean
  reference: string | null
  closedAt: string | null
  refundedAt: string | null
}

/** The ids to mark "Paid by another method" after `paid` was approved. */
export function checkoutsToClose(rows: OpenCheckoutRow[], paid: { id: string; planCode: string }): string[] {
  return rows
    .filter(
      (r) =>
        r.id !== paid.id &&
        r.planCode === paid.planCode &&
        r.status === 'pending' &&
        !r.closedAt &&
        !r.refundedAt &&
        !r.hasScreenshot &&
        // A bank-transfer checkout with a typed transaction id is a receipt too.
        !(r.provider === 'manual' && (r.reference ?? '').trim()),
    )
    .map((r) => r.id)
}
