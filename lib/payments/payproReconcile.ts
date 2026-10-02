import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { getPayproOrderStatus, payProIdFromRow } from '@/lib/payments/paypro'
import { payproOrderAccepted } from '@/lib/payments/payproVerify'
import { activatePayment } from '@/lib/payments/activate'

// The ONE "confirm a PayPro order and activate it" path (PR104). The callback,
// the return page and the reconcile cron all call this, so the amount rule
// (lib/payproVerify) and the recording live in one place — not three copies, as
// in PR103 where every copy of the guard rejected every paid order.
//
// It is idempotent (an already-approved row short-circuits, and activatePayment
// is itself idempotent), records what PayPro reported for finance (amount paid,
// the gateway fee, how it was paid) in the row's raw, and never logs a secret.

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
}

export async function confirmPayproOrder(row: PayproRow): Promise<ConfirmResult> {
  // Idempotent: nothing to do for an already-approved row.
  if (row.status === 'approved') {
    return { activated: false, alreadyActive: true, accepted: true, ggosOk: true }
  }

  const status = await getPayproOrderStatus(payProIdFromRow(row))
  if (!status.ok) return { activated: false, alreadyActive: false, accepted: false, ggosOk: false, reason: 'ggos_failed' }

  const verdict = payproOrderAccepted(
    {
      orderStatus: status.orderStatus,
      amountPayable: status.amountPayable,
      amountPaid: status.amountPaid,
      orderNumber: status.orderNumber,
    },
    { ourPrice: Number(row.amount_pkr), ourRef: row.provider_ref },
  )
  if (!verdict.accepted) {
    return { activated: false, alreadyActive: false, accepted: false, ggosOk: true, reason: verdict.reason }
  }

  // Record what PayPro reported, for finance — amount_pkr stays OUR price.
  const admin = createAdminClient()
  if (admin) {
    const rawObj = (row.raw && typeof row.raw === 'object' ? (row.raw as Record<string, unknown>) : {}) as Record<string, unknown>
    const paypro = (rawObj.paypro && typeof rawObj.paypro === 'object' ? (rawObj.paypro as Record<string, unknown>) : {}) as Record<string, unknown>
    const d = status.raw as Record<string, unknown>
    const paid = {
      amountPaid: status.amountPaid,
      amountPayable: status.amountPayable,
      fee: Math.max(0, Math.round((status.amountPaid - status.amountPayable) * 100) / 100),
      paymentVia: typeof d.PaymentVia === 'string' ? d.PaymentVia : null,
      datePaid: typeof d.DatePaid === 'string' ? d.DatePaid : null,
      confirmedAt: new Date().toISOString(),
    }
    await admin.from('payments').update({ raw: { ...rawObj, paypro: { ...paypro, paid } } }).eq('id', row.id)
  }

  const result = await activatePayment({ paymentId: row.id, source: 'gateway' })
  return {
    activated: result.ok,
    alreadyActive: result.ok && 'alreadyActive' in result ? !!result.alreadyActive : false,
    accepted: true,
    ggosOk: true,
  }
}
