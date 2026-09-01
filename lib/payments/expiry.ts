// lib/payments/expiry.ts
//
// The daily subscription sweep: remind at T-3, expire at zero.
//
// Owner rules (CLAUDE.md, "Packages & payments"):
//   * reminder three days before expiry, by email and WhatsApp
//   * NO grace period -- powers stop the moment the plan lapses
//   * nothing is deleted. Chats, shortlists, applications and posted jobs all
//     stay; only plan powers switch off. A featured job loses its tag and
//     stays open.
//
// A point worth being clear about: this job is not what enforces expiry.
// getEntitlements() filters on `expires_at > now()`, so a lapsed plan grants
// nothing from the second it lapses, whether or not the cron has run. The
// sweep exists to tell the member, to flip the denormalised flags that browse
// listings read, and to keep `status` honest for the admin screens.
//
// Both halves are idempotent: reminders are guarded by reminded_at, expiry by
// status. Running twice in one day changes nothing the second time.

import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'

export type SweepResult = {
  remindersSent: number
  expired: number
  featuredTutorsCleared: number
  featuredJobsCleared: number
  errors: string[]
}

const REMINDER_DAYS = 3

/**
 * Delivery hook for the T-3 reminder.
 *
 * The in-app notification is written by the caller and is real today. Email
 * and WhatsApp delivery land in T8 alongside the SMS provider decision; this
 * is where they attach. It logs rather than pretends, so nobody reads the
 * cron output and concludes a message went out that did not.
 */
async function deliverExpiryReminder(params: {
  userId: string
  email: string | null
  phone: string | null
  planName: string
  expiresAt: string
}): Promise<void> {
  // TODO(T8): send the email and the WhatsApp message here.
  console.info(
    '[expiry] reminder queued (in-app only until T8 wires delivery)',
    params.userId,
    params.planName,
    params.expiresAt,
  )
}

export async function runSubscriptionSweep(now = new Date()): Promise<SweepResult> {
  const result: SweepResult = {
    remindersSent: 0,
    expired: 0,
    featuredTutorsCleared: 0,
    featuredJobsCleared: 0,
    errors: [],
  }

  const admin = createAdminClient()
  if (!admin) {
    result.errors.push('service-role client unavailable')
    return result
  }

  const { data: planRows } = await admin.from('plans').select('code, name, audience')
  const plans = new Map(
    (planRows ?? []).map((p) => [
      p.code as string,
      { name: p.name as string, audience: p.audience as string },
    ]),
  )

  // ------------------------------------------------------------ reminders --
  const reminderCutoff = new Date(now.getTime() + REMINDER_DAYS * 86_400_000)

  const { data: expiringSoon } = await admin
    .from('subscriptions')
    .select('id, user_id, plan_code, expires_at')
    .eq('status', 'active')
    .is('reminded_at', null)
    .gt('expires_at', now.toISOString())
    .lte('expires_at', reminderCutoff.toISOString())

  for (const sub of expiringSoon ?? []) {
    const plan = plans.get(sub.plan_code as string)
    const planName = plan?.name ?? (sub.plan_code as string)
    const expiresAt = sub.expires_at as string
    const userId = sub.user_id as string

    const { data: profile } = await admin
      .from('profiles')
      .select('email, phone_number, role')
      .eq('id', userId)
      .maybeSingle()

    await notify({
      userId,
      kind: 'plan_expiring',
      title: `Your ${planName} plan ends in ${daysUntil(now, expiresAt)} days`,
      body: 'Renew to keep your badges, ranking and monthly allowance. There is no grace period.',
      href: profile?.role === 'tutor' ? '/tutor/packages' : '/parent/packages',
    })

    await deliverExpiryReminder({
      userId,
      email: (profile?.email as string) ?? null,
      phone: (profile?.phone_number as string) ?? null,
      planName,
      expiresAt,
    })

    await logActivity({
      userId,
      event: 'plan_expiring',
      targetType: 'subscription',
      targetId: sub.id as string,
      meta: { planCode: sub.plan_code, expiresAt },
    })

    // Stamped after the work, so a crash mid-sweep re-sends rather than
    // silently swallowing the only warning a member gets.
    const { error } = await admin
      .from('subscriptions')
      .update({ reminded_at: now.toISOString() })
      .eq('id', sub.id)

    if (error) result.errors.push(`reminder stamp ${sub.id}: ${error.message}`)
    else result.remindersSent += 1
  }

  // --------------------------------------------------------------- expiry --
  const { data: lapsed } = await admin
    .from('subscriptions')
    .select('id, user_id, plan_code, expires_at')
    .eq('status', 'active')
    .not('expires_at', 'is', null)
    .lte('expires_at', now.toISOString())

  for (const sub of lapsed ?? []) {
    const userId = sub.user_id as string
    const planCode = sub.plan_code as string
    const plan = plans.get(planCode)
    const planName = plan?.name ?? planCode

    const { error } = await admin
      .from('subscriptions')
      .update({ status: 'expired' })
      .eq('id', sub.id)
      .eq('status', 'active')

    if (error) {
      result.errors.push(`expire ${sub.id}: ${error.message}`)
      continue
    }
    result.expired += 1

    // Denormalised Featured flags follow the plan. Neither of these deletes
    // anything: the tutor stays listed, the job stays open, they simply stop
    // being promoted.
    if (planCode === 'featured') {
      const { error: e } = await admin
        .from('tutor_profiles')
        .update({ is_featured: false })
        .eq('id', userId)
      if (e) result.errors.push(`untag tutor ${userId}: ${e.message}`)
      else result.featuredTutorsCleared += 1
    }

    if (planCode === 'parent_featured') {
      const { data: untagged, error: e } = await admin
        .from('jobs')
        .update({ is_featured: false })
        .eq('parent_id', userId)
        .eq('is_featured', true)
        .select('id')
      if (e) result.errors.push(`untag jobs ${userId}: ${e.message}`)
      else result.featuredJobsCleared += (untagged ?? []).length
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle()

    await notify({
      userId,
      kind: 'plan_expired',
      title: `Your ${planName} plan has expired`,
      body: 'Everything is still in your dashboard — your chats, applications and posts are untouched. Renew whenever you are ready.',
      href: profile?.role === 'tutor' ? '/tutor/packages' : '/parent/packages',
    })

    await logActivity({
      userId,
      event: 'plan_expired',
      targetType: 'subscription',
      targetId: sub.id as string,
      meta: { planCode, expiresAt: sub.expires_at },
    })
  }

  return result
}

function daysUntil(now: Date, iso: string): number {
  return Math.max(1, Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000))
}
