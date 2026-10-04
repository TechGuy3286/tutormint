import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'
import { deliverEmail } from '@/lib/notify'
import type { AdminRole } from '@/lib/adminAuth'
import { resolveRefundAmount, type RefundMethod } from '@/lib/payments/refundCore'
import { formatDate } from '@/lib/datetime'

// Record a refund against an APPROVED payment (PR106-H4 §4). The original row is
// NEVER deleted — the refund fields are set beside it, and net revenue =
// amount - refunded_amount (adminOverview). Refunding a duplicate does NOT
// change the member's paid status: verified_fee_paid_at is untouched, so another
// approved fee payment keeps them verified. Audited, on the member's history,
// and the member is told in-app and by email. No card details are ever stored
// or sent — method is a channel name (PayPro/JazzCash/Easypaisa/Bank) only.

export type RecordRefundInput = {
  paymentId: string
  /** null = full remaining amount. */
  amountPkr: number | null
  method: RefundMethod
  reference: string
  reason: string
  proofPath?: string | null
  actor: { id: string; adminRole: AdminRole; email: string | null }
}

export async function recordRefund(
  input: RecordRefundInput,
): Promise<{ ok: true; amount: number } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  const { data: payment } = await admin
    .from('payments')
    .select('id, user_id, amount_pkr, status, refunded_amount_pkr, plan_code')
    .eq('id', input.paymentId)
    .maybeSingle()
  if (!payment) return { ok: false, status: 404, error: 'Payment not found.' }
  if (payment.status !== 'approved') {
    return { ok: false, status: 400, error: 'Only an approved payment can be refunded.' }
  }

  const already = (payment.refunded_amount_pkr as number | null) ?? 0
  const resolved = resolveRefundAmount(input.amountPkr, payment.amount_pkr as number, already)
  if (!resolved.ok) return { ok: false, status: 400, error: resolved.error }
  const newTotal = already + resolved.amount

  const now = new Date().toISOString()
  const { error } = await admin
    .from('payments')
    .update({
      refunded_amount_pkr: newTotal,
      refund_method: input.method,
      refund_reference: input.reference.trim() || null,
      refund_reason: input.reason.trim() || null,
      refund_proof_path: input.proofPath ?? null,
      refunded_at: now,
      refunded_by: input.actor.id,
    })
    .eq('id', input.paymentId)
  if (error) return { ok: false, status: 400, error: error.message }

  await logAdminAction({
    actorId: input.actor.id,
    actorRole: input.actor.adminRole,
    actorEmail: input.actor.email,
    action: 'payment.refund',
    targetType: 'payment',
    targetId: input.paymentId,
    // No card details — amount, channel and reason only.
    detail: { amountPkr: resolved.amount, method: input.method, reason: input.reason, totalRefunded: newTotal },
  })

  const memberId = payment.user_id as string
  await logActivity({
    userId: memberId,
    event: 'refund_recorded',
    targetType: 'payment',
    targetId: input.paymentId,
    meta: { amountPkr: resolved.amount, method: input.method },
  })

  const when = formatDate(now)
  await notify({
    userId: memberId,
    kind: 'refund_recorded',
    title: 'Refund sent',
    body: `Refund sent: Rs ${resolved.amount.toLocaleString('en-PK')} to your ${input.method} — ${when}.`,
    href: '/tutor/dashboard#payments',
  }).catch(() => {})
  await deliverEmail(
    { userId: memberId },
    { id: 'refund_recorded', amountPkr: resolved.amount, method: input.method, whenDate: when },
  ).catch(() => {})

  return { ok: true, amount: resolved.amount }
}
