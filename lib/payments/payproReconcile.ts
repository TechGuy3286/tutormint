import 'server-only'

import { recordFinanceAlert } from '@/lib/financeAlerts'

// PayPro orders after PayPro ENDED (owner, 20 Nov 2026 — PR-12).
//
// This used to be the ONE "confirm a PayPro order with Get Order Status and
// activate it" path (PR104). PayPro no longer works with TutorMint and its API
// client is gone, so nothing here calls PayPro and NOTHING activates: the
// callback (/paypro/uis), the return page and the Owner's "Check payment
// status" all land here and get "PayPro has ended". The shape of the result is
// kept so those callers stay simple.

export type PayproRow = {
  id: string
  amount_pkr: number
  status: string
  provider_ref: string
  raw: unknown
  paypro_id?: string | null
}

export type ConfirmResult = {
  activated: boolean
  alreadyActive: boolean
  accepted: boolean
  ggosOk: boolean
  reason?: string
  orderStatus?: string
  amountPayable?: number
  amountPaid?: number
  ggosError?: string
  /** A PayPro "paid" notice arrived after PayPro ended: recorded for the Owner
   *  under Finance → Needs attention, nobody activated. */
  recordedLate?: boolean
}

/** Never activates. An already-approved row is reported as active (nothing to
 *  do); anything else is "PayPro has ended". No PayPro call, no data change. */
export async function confirmPayproOrder(row: PayproRow): Promise<ConfirmResult> {
  if (row.status === 'approved') {
    return { activated: false, alreadyActive: true, accepted: true, ggosOk: true }
  }
  return { activated: false, alreadyActive: false, accepted: false, ggosOk: false, reason: 'paypro_ended' }
}

/**
 * A PayPro callback said an order was paid, after PayPro ended. We cannot (and
 * do not) confirm it with PayPro any more, so nobody is activated and the
 * payment row is not touched; the Owner gets one Finance → Needs attention line
 * per order (recordFinanceAlert de-duplicates by kind + ref) to check the PayPro
 * portal and refund or grant by hand. Never throws.
 */
export async function recordLatePayproNotice(row: PayproRow): Promise<boolean> {
  if (row.status === 'approved') return false
  try {
    await recordFinanceAlert({
      kind: 'paypro_late',
      ref: row.provider_ref,
      title: `PayPro sent a "paid" notice for order ${row.provider_ref} after PayPro ended`,
      detail: 'Not confirmed and not activated. Check the PayPro portal, then grant or refund by hand.',
      amountPkr: Number(row.amount_pkr),
      happenedAt: new Date().toISOString(),
    })
    return true
  } catch {
    return false
  }
}
