// lib/nonRefundableCore.ts
//
// The non-refundable Verification Fee wording (owner, 20 Nov 2026 — PR-12).
// PURE and client-safe: the payment page, the receipt route, Terms, the FAQ and
// the tests all read these exact strings. Never an amount here (no prices on
// public pages — the fee amount is shown only on /pay/choose's own Amount row).

/** Shown just above the payment page's Submit button, on Terms and in the FAQ. */
export const NON_REFUNDABLE_NOTICE =
  'The verification fee is non-refundable. It covers the cost of checking your documents and running the platform. Paying is your choice — you can use TutorMint without paying.'

/** The required tick box on the payment page. */
export const NON_REFUNDABLE_TICK = 'I understand the fee is non-refundable'

/** Terms → Fees and refunds: what we do return. */
export const DOUBLE_CHARGE_LINE =
  'If you are charged twice, or money is taken but the payment fails, contact us on WhatsApp and we will return the extra amount.'

/** The one line on the fee receipt email and in-app message. */
export const NON_REFUNDABLE_RECEIPT_LINE = 'This fee is non-refundable.'

/** The receipt route's refusal when the box was not ticked (plain English). */
export const NON_REFUNDABLE_TICK_NEEDED = 'Please tick “I understand the fee is non-refundable” before you submit.'

/** The form field the payment page sends ('1' when ticked). */
export const NON_REFUNDABLE_FIELD = 'nonRefundableAck'

/** True only for the exact ticked value — anything else is "not ticked". */
export function nonRefundableTicked(value: unknown): boolean {
  return value === '1'
}

/** The same notice on the payment page for a monthly plan (PR-13): Premium or
 *  Featured is not "the verification fee". No amount, as above. */
export const NON_REFUNDABLE_PLAN_NOTICE =
  'This plan is non-refundable. It runs for 30 days and cannot be cancelled part-way. Paying is your choice — you can use TutorMint without paying.'
