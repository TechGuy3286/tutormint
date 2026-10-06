import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { refundState, refundLabel } from '@/lib/payments/refundCore'
import { FEE_LABEL } from '@/lib/display'

// A member's own payments for the dashboard "Payments" section (PR106-H4
// §4.12; relabelled 6 Oct 2026). No wallet, no balance — a plain list: what each
// payment was for, how much, its status, and a small "Refunded" tag when one was
// recorded against it (the refund details themselves stay in admin).

export type PaymentHistoryRow = {
  id: string
  date: string
  what: string
  amountPkr: number
  status: string
  /** '', 'Refunded' or 'Partly refunded'. */
  refundLabel: string
  refundedAmountPkr: number | null
  refundMethod: string | null
  refundedAt: string | null
}

export async function loadPaymentsHistory(userId: string): Promise<PaymentHistoryRow[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const { data: rows } = await admin
    .from('payments')
    .select('id, plan_code, amount_pkr, status, created_at, reviewed_at, refunded_amount_pkr, refund_method, refunded_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (!rows || rows.length === 0) return []

  const { data: plans } = await admin.from('plans').select('code, name')
  const planName = new Map((plans ?? []).map((p) => [p.code as string, p.name as string]))

  const whatFor = (code: string) =>
    code === 'verified' ? FEE_LABEL : `${planName.get(code) ?? code} plan`

  // Show the payments that resulted in money moving or a refund — approved
  // payments and anything with a refund. Pending/rejected attempts are noise here.
  return rows
    .filter((r) => r.status === 'approved' || ((r.refunded_amount_pkr as number | null) ?? 0) > 0)
    .map((r) => {
      const amount = r.amount_pkr as number
      const refunded = (r.refunded_amount_pkr as number | null) ?? null
      return {
        id: r.id as string,
        date: (r.reviewed_at as string | null) ?? (r.created_at as string),
        what: whatFor((r.plan_code as string) ?? ''),
        amountPkr: amount,
        status: r.status as string,
        refundLabel: refundLabel(refundState(amount, refunded)),
        refundedAmountPkr: refunded,
        refundMethod: (r.refund_method as string | null) ?? null,
        refundedAt: (r.refunded_at as string | null) ?? null,
      }
    })
}
