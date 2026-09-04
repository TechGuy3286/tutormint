// lib/payments/activate.ts
//
// The one place a plan starts.
//
// Reached from exactly two callers: a signature-verified webhook, and an
// audited admin approval on /admin/payments. Both end here so that a
// gateway purchase and a manually-approved bank transfer produce identical
// state -- the same subscription row, the same badge, the same notification,
// the same activity event. A member who paid by bank transfer must not end up
// with a subtly different account from one who paid by card.
//
// Idempotent by construction. An already-approved payment returns
// { alreadyActive: true } and changes nothing, so a replayed webhook -- which
// gateways do send, sometimes days later -- cannot mint a second month.
//
// Written through the service-role client: activation is a platform decision,
// not a member action, and `subscriptions` is deliberately not member-writable.

import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activityLog'
import { logAdminAction } from '@/lib/auditLog'
import { notify } from '@/lib/notifications'
import { deliverEmail } from '@/lib/notify'
import type { AdminRole } from '@/lib/adminAuth'
import { formatDate } from '@/lib/datetime'

export type ActivationResult =
  | { ok: true; alreadyActive: true; subscriptionId: string | null }
  | { ok: true; alreadyActive: false; subscriptionId: string; planCode: string; expiresAt: string }
  | { ok: false; status: number; error: string }

export type ActivationSource = 'gateway' | 'manual_approval'

/**
 * Turn the denormalised Featured flags on for a plan that has just started.
 *
 * `tutor_profiles.is_featured` and `jobs.is_featured` exist so the browse and
 * ranking queries do not have to join subscriptions on every row. They are a
 * cache of the plan, and the expiry sweep clears them.
 *
 * The jobs half matters because of an asymmetry that would otherwise be unfair:
 * a job's tag is stamped at post time, and expiry strips it. Without this, a
 * parent whose plan lapsed and who then renewed would have permanently lost the
 * promotion on jobs they had paid to feature. Only OPEN jobs are re-tagged --
 * a filled or closed job is not competing for anything.
 *
 * Shared with the admin grant path so a granted plan and a bought plan leave
 * the account in the same state.
 */
export async function applyPlanFlags(userId: string, planCode: string): Promise<void> {
  const admin = createAdminClient()
  if (!admin) return

  if (planCode === 'featured') {
    await admin.from('tutor_profiles').update({ is_featured: true }).eq('id', userId)
  }

  if (planCode === 'parent_featured') {
    await admin
      .from('jobs')
      .update({ is_featured: true })
      .eq('parent_id', userId)
      .eq('status', 'open')
  }
}

/**
 * Approve a payment and put the plan live.
 *
 * Upgrade path (CLAUDE.md: no proration, and the packages page says so):
 * whatever is active is cancelled and the new plan runs a fresh
 * plans.duration_days from now. Simple to explain, simple to audit, and it
 * cannot leave two active subscriptions fighting over which one
 * getEntitlements picks.
 */
export async function activatePayment(params: {
  paymentId: string
  source: ActivationSource
  /** Present when a finance admin approved a manual transfer. */
  actor?: { id: string; adminRole: AdminRole; email: string | null }
}): Promise<ActivationResult> {
  const admin = createAdminClient()
  if (!admin) {
    return { ok: false, status: 503, error: 'Server is not configured to activate payments.' }
  }

  const { data: payment } = await admin
    .from('payments')
    .select('id, user_id, plan_code, amount_pkr, status, provider, provider_ref')
    .eq('id', params.paymentId)
    .maybeSingle()

  if (!payment) return { ok: false, status: 404, error: 'Payment not found.' }

  if (payment.status === 'approved') {
    const { data: existing } = await admin
      .from('subscriptions')
      .select('id')
      .eq('payment_id', payment.id)
      .maybeSingle()
    return { ok: true, alreadyActive: true, subscriptionId: (existing?.id as string) ?? null }
  }

  if (payment.status === 'rejected') {
    return { ok: false, status: 409, error: 'That payment was rejected and cannot be activated.' }
  }

  const planCode = payment.plan_code as string | null
  if (!planCode) return { ok: false, status: 400, error: 'That payment has no plan attached.' }

  const { data: plan } = await admin
    .from('plans')
    .select('code, name, audience, duration_days')
    .eq('code', planCode)
    .maybeSingle()
  if (!plan) return { ok: false, status: 400, error: 'Unknown plan code.' }

  const userId = payment.user_id as string
  const { data: profile } = await admin
    .from('profiles')
    .select('id, role')
    .eq('id', userId)
    .maybeSingle()
  if (!profile) return { ok: false, status: 404, error: 'Account not found.' }

  // A tutor plan on a parent account grants nonsense: getEntitlements filters
  // subscriptions by audience, so the member would pay and get nothing. Refuse
  // loudly instead, and leave the payment pending for a human to sort out.
  const audience = profile.role === 'tutor' ? 'tutor' : 'parent'
  if (plan.audience !== audience) {
    return {
      ok: false,
      status: 400,
      error: `"${plan.name}" is a ${plan.audience} plan; this account is a ${audience}.`,
    }
  }

  // One active subscription at a time. A paused one is cancelled too -- a fresh
  // purchase supersedes an earlier paused buy.
  await admin
    .from('subscriptions')
    .update({ status: 'cancelled' })
    .eq('user_id', userId)
    .in('status', ['active', 'paused'])

  // THE MONTH STARTS AT GO-LIVE. A tutor who buys while not yet listed (under
  // 100%, or verification not yet passed) gets an activated-but-PAUSED
  // subscription: paid for, but the 30 days do not begin until they appear in
  // the directory. lib/payments/goLive.ts flips it to active on that day. A
  // parent, or a tutor already listed, activates immediately as before.
  let paused = false
  if (audience === 'tutor') {
    const { data: listedRow } = await admin
      .from('tutor_directory')
      .select('id')
      .eq('id', userId)
      .maybeSingle()
    paused = !listedRow
  }

  const startsAt = new Date()
  const days = (plan.duration_days as number) || 30
  const expiresAt = new Date(startsAt.getTime() + days * 86_400_000)

  const { data: sub, error: subError } = await admin
    .from('subscriptions')
    .insert({
      user_id: userId,
      plan_code: planCode,
      // A paused plan has no CLOCK: expires_at stays NULL until go-live, so the
      // sweep (which filters expires_at) and getEntitlements both leave it be.
      // starts_at is NOT NULL, so it records the purchase instant and is reset
      // to the real start on the day the plan goes live.
      starts_at: startsAt.toISOString(),
      expires_at: paused ? null : expiresAt.toISOString(),
      status: paused ? 'paused' : 'active',
      source: 'purchase',
      payment_id: payment.id,
    })
    .select('id')
    .single()

  if (subError) return { ok: false, status: 400, error: subError.message }

  const { error: payError } = await admin
    .from('payments')
    .update({
      status: 'approved',
      reviewed_by: params.actor?.id ?? null,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', payment.id)

  if (payError) {
    // The subscription is live but the payment still reads pending, which
    // would let an admin approve it a second time and grant another month.
    // Roll the subscription back rather than leave that door open.
    await admin.from('subscriptions').delete().eq('id', sub.id)
    return { ok: false, status: 400, error: payError.message }
  }

  // Featured flags are a cache of a RUNNING plan. A paused plan is not running,
  // so it is not tagged until go-live (goLive.ts calls applyPlanFlags then).
  if (!paused) await applyPlanFlags(userId, planCode)

  await notify({
    userId,
    kind: 'plan_activated',
    title: paused ? `${plan.name} plan is ready` : `${plan.name} plan is active`,
    body: paused
      ? `Your ${plan.name} plan is paid for. Your month starts the day you go live — finish your profile to 100% and it begins automatically. There are no refunds.`
      : `Your ${plan.name} plan runs until ${formatDate(expiresAt)}. There are no refunds.`,
    href: audience === 'tutor' ? '/tutor/dashboard' : '/parent/dashboard',
  })

  // The receipt. Essential mail: it is the only record a member has of what
  // they paid and when the plan runs out, and it states the no-refund rule
  // where they will actually read it.
  const { data: buyer } = await admin
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle()

  const mailed = await deliverEmail(
    { userId },
    {
      id: 'plan_activated',
      name: (buyer?.full_name as string) ?? 'there',
      planName: plan.name as string,
      expiresAt: formatDate(expiresAt),
      amountPkr: (payment.amount_pkr as number) ?? 0,
    },
  )
  if (!mailed.ok) console.info('[activate] receipt email not sent:', mailed.reason, userId)

  await logActivity({
    userId,
    event: 'plan_purchased',
    targetType: 'subscription',
    targetId: sub.id as string,
    meta: {
      planCode,
      amountPkr: payment.amount_pkr,
      provider: payment.provider,
      source: params.source,
      expiresAt: expiresAt.toISOString(),
    },
  })

  // Only the human decision is an admin action. A gateway activation has no
  // actor, and inventing one would make the audit log lie.
  if (params.actor) {
    await logAdminAction({
      actorId: params.actor.id,
      actorRole: params.actor.adminRole,
      actorEmail: params.actor.email,
      action: 'payment.approve',
      targetType: 'payment',
      targetId: payment.id as string,
      detail: {
        userId,
        planCode,
        amountPkr: payment.amount_pkr,
        provider: payment.provider,
        reference: payment.provider_ref,
        subscriptionId: sub.id,
        expiresAt: expiresAt.toISOString(),
      },
    })
  }

  return {
    ok: true,
    alreadyActive: false,
    subscriptionId: sub.id as string,
    planCode,
    expiresAt: expiresAt.toISOString(),
  }
}

/**
 * Record a failed or refused payment. Never touches the member's plan --
 * a failed upgrade leaves the plan they already had exactly as it was.
 */
export async function rejectPayment(params: {
  paymentId: string
  reason: string
  actor?: { id: string; adminRole: AdminRole; email: string | null }
}): Promise<{ ok: boolean; status?: number; error?: string }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, status: 503, error: 'Server is not configured.' }

  const { data: payment } = await admin
    .from('payments')
    .select('id, user_id, plan_code, status')
    .eq('id', params.paymentId)
    .maybeSingle()

  if (!payment) return { ok: false, status: 404, error: 'Payment not found.' }
  if (payment.status === 'approved') {
    return { ok: false, status: 409, error: 'That payment is already approved.' }
  }
  if (payment.status === 'rejected') return { ok: true }

  await admin
    .from('payments')
    .update({
      status: 'rejected',
      rejection_reason: params.reason,
      reviewed_by: params.actor?.id ?? null,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', payment.id)

  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', payment.user_id as string)
    .maybeSingle()

  await notify({
    userId: payment.user_id as string,
    kind: 'payment_rejected',
    title: 'We could not confirm your payment',
    body: params.reason,
    href: profile?.role === 'tutor' ? '/tutor/packages' : '/parent/packages',
  })

  if (params.actor) {
    await logAdminAction({
      actorId: params.actor.id,
      actorRole: params.actor.adminRole,
      actorEmail: params.actor.email,
      action: 'payment.reject',
      targetType: 'payment',
      targetId: payment.id as string,
      detail: { userId: payment.user_id, planCode: payment.plan_code, reason: params.reason },
    })
  }

  return { ok: true }
}
