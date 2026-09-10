// lib/payments/goLive.ts
//
// A tutor's plan month starts the day they GO LIVE, not the day they pay.
//
// When a tutor buys while not yet listable, activatePayment() records the
// subscription as 'paused' with a NULL expires_at -- paid for, clock stopped.
// This is the other half: the moment the tutor meets the listing PRECONDITION
// (mobile verified, verification 'verified', not suspended/banned/under-review,
// claimed if imported — listing minus the plan, since 10 Sep 2026), the paused
// plan begins its full 30 days and turns on, which is what makes them listed.
//
// Called from the places listing status can change:
//   * recomputeCompletion(), after it persists a new profile_completion.
//   * the admin tutor-moderation route, after a verification decision.
// Both are idempotent through this function: it only ever acts on a PAUSED
// subscription for a tutor who is now listed, so a second call finds nothing.

import { createAdminClient } from '@/lib/supabase/admin'
import { applyPlanFlags } from '@/lib/payments/activate'
import { isTutorListable } from '@/lib/payments/listable'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'
import { formatDate } from '@/lib/datetime'

/**
 * Activate a tutor's paused plan if they are now listed. Safe to call often;
 * returns whether it started a plan.
 */
export async function activatePausedIfListed(userId: string): Promise<{ activated: boolean }> {
  const admin = createAdminClient()
  if (!admin) return { activated: false }

  // Is there anything to do? Only a paused row matters.
  const { data: paused } = await admin
    .from('subscriptions')
    .select('id, plan_code')
    .eq('user_id', userId)
    .eq('status', 'paused')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!paused) return { activated: false }

  // The BRIDGE lock (owner, Part 5): a number proved only by the BRIDGE_OTP
  // stopgap cannot start a paid plan. Do not begin the 30 days — the paused row
  // waits until they re-verify with a real code, so a bridge account never
  // burns a month it cannot use. getEntitlements withholds powers regardless;
  // this is what stops the clock. Checked for BOTH roles, because a paused
  // PARENT sub only ever exists because of this lock (a normal parent purchase
  // activates immediately), so re-verification is exactly its trigger.
  const { data: prof } = await admin
    .from('profiles')
    .select('role, phone_verified_via')
    .eq('id', userId)
    .maybeSingle()
  if ((prof?.phone_verified_via as string | null) === 'bridge') return { activated: false }

  // The authoritative listing check applies to TUTORS only. Since 10 Sep 2026
  // listing requires an active plan, so "am I listed?" would deadlock here (the
  // plan being started is what the directory waits on). Ask the PRECONDITION —
  // listing minus the plan — which is exactly what starting this plan completes.
  // A parent is not listed anywhere, so a paused parent sub (only ever a
  // bridge-blocked purchase) activates once the bridge lock above has cleared.
  if (prof?.role === 'tutor') {
    if (!(await isTutorListable(userId))) return { activated: false }
  }

  const planCode = paused.plan_code as string
  const { data: plan } = await admin
    .from('plans')
    .select('name, duration_days')
    .eq('code', planCode)
    .maybeSingle()

  const now = new Date()
  const days = (plan?.duration_days as number) || 30
  const expiresAt = new Date(now.getTime() + days * 86_400_000)

  // Guard the flip on status='paused' so two concurrent go-live triggers cannot
  // both start a month.
  const { data: flipped, error } = await admin
    .from('subscriptions')
    .update({
      status: 'active',
      starts_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .eq('id', paused.id)
    .eq('status', 'paused')
    .select('id')
    .maybeSingle()
  if (error || !flipped) return { activated: false }

  await applyPlanFlags(userId, planCode)

  const planName = (plan?.name as string) ?? planCode
  const isTutor = prof?.role === 'tutor'
  await notify({
    userId,
    kind: 'plan_activated',
    title: `Your ${planName} plan has started`,
    body: isTutor
      ? `You are now listed, so your ${planName} plan is running until ${formatDate(expiresAt)}. There are no refunds.`
      : `Your ${planName} plan is now running until ${formatDate(expiresAt)}. There are no refunds.`,
    href: isTutor ? '/tutor/dashboard' : '/parent/dashboard',
  })

  await logActivity({
    userId,
    event: 'plan_purchased',
    targetType: 'subscription',
    targetId: paused.id as string,
    meta: { planCode, startedOnGoLive: true, expiresAt: expiresAt.toISOString() },
  })

  return { activated: true }
}
