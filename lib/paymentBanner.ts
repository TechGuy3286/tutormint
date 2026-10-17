// lib/paymentBanner.ts — the I/O half of the "payment started, not finished"
// banner (owner, 17 Oct 2026). Rules in lib/paymentBannerCore.
//
// Reads with the service role, scoped to the one member id the caller passes
// (the signed-in member). Cancelling only ever MARKS the member's own pending,
// receipt-less, not-refunded checkout; nothing is deleted.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { FEE_LABEL } from '@/lib/display'
import {
  bannerFor,
  closable,
  type Banner,
  type BannerPayment,
  type BannerPlan,
  type Holdings,
} from '@/lib/paymentBannerCore'

const PAYMENT_COLS =
  'id, plan_code, status, created_at, provider, provider_ref, screenshot_path, reference, refunded_at, checkout_closed_at'

function toBannerPayment(p: Record<string, unknown>): BannerPayment {
  return {
    id: p.id as string,
    planCode: (p.plan_code as string | null) ?? null,
    status: p.status as string,
    createdAt: p.created_at as string,
    provider: (p.provider as string | null) ?? null,
    providerRef: (p.provider_ref as string | null) ?? null,
    hasReceipt: !!(p.screenshot_path as string | null) || !!((p.reference as string | null) ?? '').trim(),
    refundedAt: (p.refunded_at as string | null) ?? null,
    closedAt: (p.checkout_closed_at as string | null) ?? null,
  }
}

/** The banner for this member, or null. Never throws (no banner on a read error). */
export async function loadPaymentBanner(userId: string, audience: 'tutor' | 'parent', now = new Date()): Promise<Banner | null> {
  const admin = createAdminClient()
  if (!admin) return null
  try {
    const [pend, approved, subs, tp, plansRes] = await Promise.all([
      admin.from('payments').select(PAYMENT_COLS).eq('user_id', userId).eq('status', 'pending').order('created_at', { ascending: false }).limit(20),
      admin.from('payments').select('plan_code, created_at, reviewed_at, refunded_at').eq('user_id', userId).eq('status', 'approved').limit(50),
      admin.from('subscriptions').select('plan_code, expires_at').eq('user_id', userId).eq('status', 'active').limit(20),
      audience === 'tutor'
        ? admin.from('tutor_profiles').select('verified_fee_paid_at').eq('id', userId).maybeSingle()
        : Promise.resolve({ data: null }),
      admin.from('plans').select('code, name, audience, price_pkr'),
    ])
    if (pend.error || !pend.data || pend.data.length === 0) return null
    const nowMs = now.getTime()
    const h: Holdings = {
      audience,
      feePaid: !!(tp.data as { verified_fee_paid_at?: string | null } | null)?.verified_fee_paid_at,
      activePlans: (subs.data ?? [])
        .filter((s) => !s.expires_at || Date.parse(s.expires_at as string) > nowMs)
        .map((s) => s.plan_code as string),
      approved: (approved.data ?? [])
        .filter((a) => !a.refunded_at)
        .map((a) => ({ planCode: a.plan_code as string, at: ((a.reviewed_at as string | null) ?? (a.created_at as string)) as string })),
    }
    const plans = new Map<string, BannerPlan>(
      (plansRes.data ?? []).map((p) => [
        p.code as string,
        { code: p.code as string, name: p.name as string, audience: p.audience as string, pricePkr: Number(p.price_pkr) },
      ]),
    )
    return bannerFor(pend.data.map(toBannerPayment), h, plans, nowMs, FEE_LABEL)
  } catch {
    return null
  }
}

export type CancelResult = { ok: true } | { ok: false; status: number; error: string }

/** The member cancels their own checkout: marked closed, nothing deleted. */
export async function cancelCheckout(userId: string, paymentId: string): Promise<CancelResult> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'This is not working right now. Please try again in a few minutes.' }
  const { data: p } = await admin
    .from('payments')
    .select('id, user_id, status, screenshot_path, reference, refunded_at, checkout_closed_at')
    .eq('id', paymentId)
    .maybeSingle()
  if (!p || p.user_id !== userId) return { ok: false, status: 404, error: 'That payment was not found.' }
  if (p.checkout_closed_at) return { ok: true }
  const row = {
    status: p.status as string,
    hasReceipt: !!p.screenshot_path || !!((p.reference as string | null) ?? '').trim(),
    refundedAt: (p.refunded_at as string | null) ?? null,
  }
  if (!closable(row)) return { ok: false, status: 409, error: 'This payment cannot be cancelled.' }
  // The same conditions again in the UPDATE, so a payment that was approved,
  // refunded or given a receipt a moment ago is never marked.
  const { error } = await admin
    .from('payments')
    .update({ checkout_closed_at: new Date().toISOString(), checkout_close_reason: 'cancelled_by_member', checkout_closed_by: userId })
    .eq('id', paymentId)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .is('refunded_at', null)
    .is('screenshot_path', null)
    .is('checkout_closed_at', null)
  if (error) return { ok: false, status: 500, error: 'That did not save. Please try again.' }
  return { ok: true }
}
