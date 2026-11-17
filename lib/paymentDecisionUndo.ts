import 'server-only'

// lib/paymentDecisionUndo.ts — Reopen and the 10-second Undo on a payment
// (owner, 17 Nov 2026 — PR-03). Rules in lib/bankStatementCore.ts
// (reopenProblem, undoDecisionProblem).
//
//   reopenPayment()   OWNER ONLY (the route checks): a rejected bank-transfer
//                     receipt goes back to "Waiting for approval", with a reason.
//   undoDecision()    whoever approved or rejected, within a minute (the button
//                     shows for 10 seconds): back to waiting. An undone approval
//                     removes what it gave (the badge, or the plan) and
//                     soft-removes the bank-credit link — the same steps as the
//                     Owner's Undo of a staff approval.
// Nothing is deleted; every step is in admin_audit_log.

import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { notify } from '@/lib/notifications'
import { existingFeeFor } from '@/lib/feeMatch'
import { reopenProblem, undoDecisionProblem } from '@/lib/bankStatementCore'
import type { AdminRole } from '@/lib/adminAccessCore'

type Actor = { id: string; adminRole: AdminRole; email: string | null }
type Result = { ok: true } | { ok: false; status: number; error: string }
const NOT_NOW = 'This is not working right now. Please try again in a few minutes.'

export async function reopenPayment(paymentId: string, reason: string, actor: Actor): Promise<Result> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const { data: p } = await admin.from('payments').select('id, status, provider, user_id, plan_code, rejection_reason').eq('id', paymentId).maybeSingle()
  const problem = reopenProblem(p ? { status: String(p.status), provider: (p.provider as string | null) ?? null } : null, reason)
  if (problem) return { ok: false, ...problem }
  const now = new Date().toISOString()
  const { error } = await admin
    .from('payments')
    .update({ status: 'pending', reviewed_at: null, reviewed_by: null, reopened_at: now, reopened_by: actor.id, reopen_reason: reason.trim().slice(0, 500), updated_at: now })
    .eq('id', paymentId)
    .eq('status', 'rejected')
  if (error) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  await logAdminAction({
    actorId: actor.id, actorRole: actor.adminRole, actorEmail: actor.email,
    action: 'payment.reopen', targetType: 'payment', targetId: paymentId,
    detail: { planCode: p!.plan_code, reason: reason.trim().slice(0, 300), earlierRejection: (p!.rejection_reason as string | null) ?? null },
  })
  if (p!.user_id) {
    await notify({
      userId: p!.user_id as string,
      kind: 'payment_reopened',
      title: 'We are checking your payment again',
      body: 'Your receipt is back with our team. We will tell you when it is approved.',
      href: p!.plan_code ? `/pay/choose?plan=${encodeURIComponent(String(p!.plan_code))}` : null,
    }).catch(() => null)
  }
  return { ok: true }
}

export async function undoDecision(paymentId: string, actor: Actor, now = Date.now()): Promise<Result & { undid?: 'approve' | 'reject' }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: NOT_NOW }
  const { data: p } = await admin
    .from('payments')
    .select('id, status, provider, user_id, plan_code, reviewed_at, reviewed_by, staff_approved_at')
    .eq('id', paymentId)
    .maybeSingle()
  const problem = undoDecisionProblem(
    p ? { status: String(p.status), reviewedAt: (p.reviewed_at as string | null) ?? null, reviewedBy: (p.reviewed_by as string | null) ?? null, provider: (p.provider as string | null) ?? null } : null,
    actor.id,
    now,
  )
  if (problem) return { ok: false, ...problem }
  const was = p!.status as 'approved' | 'rejected'
  const at = new Date(now).toISOString()
  const patch: Record<string, unknown> = { status: 'pending', reviewed_at: null, reviewed_by: null, decision_undone_at: at, decision_undone_by: actor.id, updated_at: at }
  if (was === 'approved') {
    patch.rounding_pkr = null
    if (p!.staff_approved_at) {
      patch.staff_approval_undone_at = at
      patch.staff_approval_undone_by = actor.id
      patch.staff_approval_undo_reason = 'Undone by the approver straight after approving'
    }
  } else {
    patch.rejection_reason = null
  }
  const { error } = await admin.from('payments').update(patch).eq('id', paymentId).eq('status', was)
  if (error) return { ok: false, status: 500, error: 'That did not save. Please try again.' }

  let removed = false
  if (was === 'approved') {
    await admin.from('settlement_links').update({ removed_at: at }).eq('kind', 'receipt').eq('target', paymentId).is('removed_at', null)
    const memberId = (p!.user_id as string | null) ?? null
    if (memberId && p!.plan_code === 'verified') {
      if (!(await existingFeeFor(memberId))) {
        await admin.from('tutor_profiles').update({ verified_fee_paid_at: null }).eq('id', memberId)
        removed = true
      }
    } else if (memberId) {
      await admin.from('subscriptions').update({ status: 'cancelled' }).eq('payment_id', paymentId).in('status', ['active', 'paused'])
      removed = true
    }
  }
  await logAdminAction({
    actorId: actor.id, actorRole: actor.adminRole, actorEmail: actor.email,
    action: was === 'approved' ? 'payment.approve_undo' : 'payment.reject_undo', targetType: 'payment', targetId: paymentId,
    detail: { planCode: p!.plan_code, removed },
  })
  if (was === 'approved' && p!.user_id) {
    await notify({
      userId: p!.user_id as string,
      kind: 'payment_reopened',
      title: 'We are checking your payment again',
      body: 'Your receipt is back with our team for one more check. We will tell you when it is approved.',
      href: null,
    }).catch(() => null)
  }
  return { ok: true, undid: was === 'approved' ? 'approve' : 'reject' }
}
