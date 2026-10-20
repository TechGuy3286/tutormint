// lib/payments/closeOtherCheckouts.ts
//
// Paid by another method (owner, 21 Oct 2026) — the I/O half. Rules in
// lib/payments/closeOtherCheckoutsCore.ts. Called after a payment is approved
// by every path: activatePayment (PayPro callback and cron, approved bank
// receipt, a bank credit linked to a member) and the bank-credit "attach" step.
// Best effort: a failure here never undoes the payment it follows.

import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { logActivity } from '@/lib/activityLog'
import { checkoutsToClose, PAID_ANOTHER_WAY, type OpenCheckoutRow } from '@/lib/payments/closeOtherCheckoutsCore'

export async function closeOtherCheckouts(
  admin: SupabaseClient,
  input: { userId: string; paymentId: string; planCode: string; actorId?: string | null },
): Promise<string[]> {
  try {
    const { data } = await admin
      .from('payments')
      .select('id, plan_code, status, provider, screenshot_path, reference, checkout_closed_at, refunded_at')
      .eq('user_id', input.userId)
      .eq('plan_code', input.planCode)
      .eq('status', 'pending')
    const rows: OpenCheckoutRow[] = ((data ?? []) as Record<string, unknown>[]).map((p) => ({
      id: String(p.id),
      planCode: (p.plan_code as string | null) ?? null,
      status: String(p.status),
      provider: (p.provider as string | null) ?? null,
      hasScreenshot: !!p.screenshot_path,
      reference: (p.reference as string | null) ?? null,
      closedAt: (p.checkout_closed_at as string | null) ?? null,
      refundedAt: (p.refunded_at as string | null) ?? null,
    }))
    const ids = checkoutsToClose(rows, { id: input.paymentId, planCode: input.planCode })
    if (ids.length === 0) return []
    const { error } = await admin
      .from('payments')
      .update({ checkout_closed_at: new Date().toISOString(), checkout_close_reason: PAID_ANOTHER_WAY, checkout_closed_by: input.actorId ?? null })
      .in('id', ids)
      .eq('status', 'pending')
    if (error) {
      console.warn('[payments] closing other checkouts failed:', error.message)
      return []
    }
    for (const id of ids) {
      await logActivity({
        userId: input.userId,
        event: 'checkout_cancelled',
        targetType: 'payment',
        targetId: id,
        meta: { reason: PAID_ANOTHER_WAY, paidBy: input.paymentId },
      })
    }
    return ids
  } catch (e) {
    console.warn('[payments] closing other checkouts failed:', e instanceof Error ? e.message : e)
    return []
  }
}
