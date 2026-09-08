// lib/payments/goLive.ts
//
// A tutor's plan month starts the day they GO LIVE, not the day they pay.
//
// When a tutor buys while under 100%, activatePayment() records the
// subscription as 'paused' with a NULL expires_at -- paid for, clock stopped.
// This is the other half: the moment the tutor becomes listed (100% complete,
// verification not rejected/suspended, claimed if imported), the paused plan
// begins its full 30 days and turns on.
//
// Called from the two places listing status can change:
//   * recomputeCompletion(), after it persists a new profile_completion.
//   * the admin tutor-moderation route, after a verification decision.
// Both are idempotent through this function: it only ever acts on a PAUSED
// subscription for a tutor who is now listed, so a second call finds nothing.

import { createAdminClient } from '@/lib/supabase/admin'
import { applyPlanFlags } from '@/lib/payments/activate'
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

  // The authoritative listing check applies to TUTORS only — "went live" means
  // "appears in the directory". A parent is not listed anywhere, so a paused
  // parent sub (which can only be a bridge-blocked purchase) activates once the
  // bridge lock above has cleared.
  if (prof?.role === 'tutor') {
    const { data: listedRow } = await admin
      .from('tutor_directory')
      .select('id')
      .eq('id', userId)
      .maybeSingle()
    if (!listedRow) return { activated: false }
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
