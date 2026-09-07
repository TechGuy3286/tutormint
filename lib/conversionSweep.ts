import 'server-only'

// The conversion sweep: two nudges the 199 funnel needs, fired once a day from
// the subscription cron (app/api/cron/subscriptions).
//
// BOTH ARE TUTOR/PARENT-FACING AND POST-SIGNUP, so the price rule ("never
// signal a paid platform to anyone who has not signed up") is satisfied by
// construction — these land in a member's bell, never on a public page.
//
// 1. The WEEKLY VIEW TEASER. `profile_viewed` already fires per view (throttled
//    to one a day, no upsell — see app/(site)/tutor/[slug]/page.tsx). This is a
//    different message: a weekly roll-up that DOES carry the Premium CTA —
//    "N parents viewed your profile this week — see who with Premium" — capped
//    at one a week, and never sent on a zero-view week (a "0 parents viewed you"
//    nudge sells nothing and reads as a taunt). It goes only to tutors who
//    cannot already see viewer identity, so a Premium or Featured tutor — who
//    already gets the name — is never pitched what they hold.
//
// 2. The QUOTA NUDGE at 80% of the month's allowance, once a period. It fires
//    only for a plan whose displayed allowance is a real number: a plan that
//    advertises "Unlimited" must never have its real 100-cap surfaced to the
//    member (CLAUDE.md), so Featured and parent_featured are skipped here.
//
// THE CAP IS THE NOTIFICATION ITSELF. Neither needs a new column: "did we
// already nudge this week / this period" is answered by looking for the last
// notification of that kind, exactly as the per-day `profile_viewed` and
// `rank_dropped` throttles do. There is nothing to keep in step.

import { createAdminClient } from '@/lib/supabase/admin'
import { getEntitlements, currentPeriod } from '@/lib/entitlements'
import { notify } from '@/lib/notifications'
import { nextUpsell } from '@/lib/upsell'

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

const WEEK_MS = 7 * 24 * 3600_000

export type ConversionSweepResult = {
  teasersSent: number
  quotaNudgesSent: number
  errors: string[]
}

/**
 * The weekly view teaser. One per tutor who was viewed in the last seven days,
 * at most one a week, only for tutors who cannot yet see who viewed them.
 */
async function deliverViewTeasers(admin: Admin): Promise<{ sent: number; errors: string[] }> {
  const errors: string[] = []
  const since = new Date(Date.now() - WEEK_MS).toISOString()

  // Count views per tutor over the window in JS — supabase-js has no group-by,
  // and the row count on a "feels free" directory is small. Bounded so a busy
  // week cannot pull an unbounded set into memory.
  const { data: views, error } = await admin
    .from('profile_views')
    .select('tutor_id')
    .gte('created_at', since)
    .limit(20000)
  if (error) return { sent: 0, errors: [`views: ${error.message}`] }

  const counts = new Map<string, number>()
  for (const v of views ?? []) {
    const id = v.tutor_id as string | null
    if (!id) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  if (counts.size === 0) return { sent: 0, errors }

  // Who already got a weekly teaser inside the window — the 1/week cap, with
  // the notification as its own record.
  const tutorIds = [...counts.keys()]
  const { data: recent } = await admin
    .from('notifications')
    .select('user_id')
    .eq('kind', 'viewer_weekly_teaser')
    .gt('created_at', since)
    .in('user_id', tutorIds)
  const capped = new Set((recent ?? []).map((r) => r.user_id as string))

  let sent = 0
  for (const [tutorId, n] of counts) {
    if (capped.has(tutorId)) continue
    try {
      const ent = await getEntitlements(tutorId)
      if (ent.suspended) continue
      if (ent.audience !== 'tutor') continue
      // Premium and Featured already see the viewer's name; the upsell would be
      // noise. The offer is always Premium (viewer identity is a Premium power).
      if (ent.canSeeViewerIdentity) continue

      await notify({
        userId: tutorId,
        kind: 'viewer_weekly_teaser',
        title: `${n} ${n === 1 ? 'parent' : 'parents'} viewed your profile this week`,
        body: 'Premium reveals who they are — see every viewer’s name.',
        href: '/tutor/packages?plan=premium',
      })
      sent++
    } catch (e) {
      errors.push(`teaser ${tutorId}: ${String(e)}`)
    }
  }
  return { sent, errors }
}

/**
 * The 80% quota nudge, once a period, only where the allowance is a real number
 * the member is already shown.
 */
async function deliverQuotaNudges(admin: Admin): Promise<{ sent: number; errors: string[] }> {
  const errors: string[] = []
  const period = currentPeriod()

  // Everyone with usage this period; entitlements then say what their cap is.
  const { data: counters, error } = await admin
    .from('usage_counters')
    .select('user_id')
    .eq('period', period)
  if (error) return { sent: 0, errors: [`counters: ${error.message}`] }
  if (!counters || counters.length === 0) return { sent: 0, errors }

  const userIds = counters.map((c) => c.user_id as string)

  // Once a period: skip anyone already nudged this calendar month. `period` is
  // YYYY-MM, so its first day is the month boundary in UTC.
  const monthStart = `${period}-01T00:00:00.000Z`
  const { data: nudged } = await admin
    .from('notifications')
    .select('user_id')
    .eq('kind', 'quota_nudge')
    .gte('created_at', monthStart)
    .in('user_id', userIds)
  const already = new Set((nudged ?? []).map((r) => r.user_id as string))

  let sent = 0
  for (const userId of userIds) {
    if (already.has(userId)) continue
    try {
      const ent = await getEntitlements(userId)
      if (ent.suspended || !ent.plan || ent.quota <= 0) continue
      // A numeric displayed allowance only. "Unlimited" plans never have their
      // real cap surfaced — so Featured and parent_featured are excluded here.
      if (!ent.displayedQuota || !/^\d+$/.test(ent.displayedQuota)) continue
      if (ent.quotaUsed / ent.quota < 0.8) continue

      const offered = nextUpsell(ent.audience, ent.plan)
      if (!offered) continue // top of ladder (and those advertise Unlimited anyway)

      const noun = ent.audience === 'tutor' ? 'applications' : 'job posts'
      const base = ent.audience === 'tutor' ? '/tutor/packages' : '/parent/packages'
      await notify({
        userId,
        kind: 'quota_nudge',
        title: `You’ve used ${ent.quotaUsed} of your ${ent.displayedQuota} ${noun} this month`,
        body: `Your allowance resets next month. Upgrade for more ${noun} now.`,
        href: `${base}?plan=${offered}`,
      })
      sent++
    } catch (e) {
      errors.push(`quota ${userId}: ${String(e)}`)
    }
  }
  return { sent, errors }
}

export async function runConversionSweep(): Promise<ConversionSweepResult> {
  const admin = createAdminClient()
  if (!admin) {
    return { teasersSent: 0, quotaNudgesSent: 0, errors: ['service-role client unavailable'] }
  }

  const teasers = await deliverViewTeasers(admin)
  const quota = await deliverQuotaNudges(admin)

  return {
    teasersSent: teasers.sent,
    quotaNudgesSent: quota.sent,
    errors: [...teasers.errors, ...quota.errors],
  }
}
