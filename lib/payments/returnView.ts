// The /pay/return result decision, pure so success/failure/cancel/bank-transfer
// are unit-tested without the page (PR106-B §9).
//
// The status is read from OUR payments row, never the gateway's query string:
//   approved → paid and active (PayPro auto-activates; bank is approved by staff)
//   notpaid  → the payment was rejected (a real failure)
//   waiting  → still pending — a just-started PayPro order, a cancel/abandon that
//              left the order open, or a bank transfer awaiting staff approval
//   unknown  → no payment row for that reference on this account

export type PayReturnView = 'approved' | 'waiting' | 'notpaid' | 'unknown'

export function payReturnView(status: string | null | undefined): PayReturnView {
  if (status === 'approved') return 'approved'
  if (status === 'rejected') return 'notpaid'
  if (status === 'pending') return 'waiting'
  return 'unknown'
}

/** Within the waiting view, the copy differs for a bank transfer (awaiting staff
 *  approval) vs a gateway order (confirming on its own). */
export function payWaitingIsManual(provider: string | null | undefined): boolean {
  return provider === 'manual'
}
