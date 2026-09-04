// lib/notifications.ts
//
// In-app notifications.
//
// Written from server code through the service-role client. `notifications`
// has read and mark-read policies only -- there is no insert policy at all --
// so nothing holding the anon key can put a notification in front of someone
// else. That matters here more than usual: a notification is a message from
// the platform, and a forged one ("your tutor has cancelled") is a very cheap
// way to manipulate somebody.

import { createAdminClient } from '@/lib/supabase/admin'

export type NotificationKind =
  | 'application_received'
  | 'application_withdrawn'
  | 'application_shortlisted'
  | 'application_rejected'
  | 'hired'
  | 'job_filled'
  | 'job_closed'
  | 'message_received'
  | 'demo_requested'
  | 'demo_accepted'
  | 'demo_declined'
  | 'demo_cancelled'
  | 'demo_feedback'
  // T6 — money and plan lifecycle.
  | 'plan_activated'
  | 'plan_expiring'
  | 'plan_expired'
  | 'payment_submitted'
  | 'payment_rejected'
  // T7a — moderation outcomes.
  | 'warning_issued'
  | 'account_suspended'
  | 'account_reinstated'
  // T-Funnel -- a matching job, told to tutors who cannot yet apply for it.
  | 'job_matched'
  // The verification decision itself. Both queues emailed the member and wrote
  // their timeline, and neither put anything in the product -- so the single
  // most consequential message the platform sends ("you are verified", "here is
  // why you were not") was the one thing a member could not find by opening the
  // site. Added when the bell shipped, because that is when it became visible.
  | 'verification_approved'
  | 'verification_rejected'
  // T-AdminJobs. An admin closing, un-featuring or removing somebody's tuition
  // is a consequential change to a thing they made; finding out by noticing it
  // gone is the worst way to learn it. No migration needed --
  // notifications.kind is text with no CHECK constraint.
  | 'job_closed_by_admin'
  | 'job_unfeatured_by_admin'
  | 'job_removed_by_admin'
  // T-SEO2. An admin moving a tutor's public URL. The old address 301s, so
  // nothing breaks -- but a tutor finding out by noticing the link they pasted
  // into WhatsApp now redirects is the version of this that becomes a support
  // ticket. No migration: notifications.kind is text with no CHECK constraint.
  | 'profile_address_changed'
  // T-Teaser. Two events that already existed as facts on the dashboard and
  // as nothing a member could be told about.
  //
  // `profile_viewed` is throttled to one a day per tutor in recordView(): a
  // notification per view would be a notification per page load by a browsing
  // parent, and the dashboard card carries the running total anyway. It never
  // names the viewer — identity is what Premium sells, and a notification is
  // not a place to give it away.
  //
  // `rank_dropped` fires from the position widget when a tutor's rank for
  // their main subject falls, at most once a day. It is a real event with a
  // real cause, which is the whole test for whether a notification should
  // exist.
  | 'profile_viewed'
  | 'rank_dropped'

export async function notify(params: {
  userId: string
  kind: NotificationKind
  title: string
  body?: string | null
  href?: string | null
}): Promise<void> {
  const admin = createAdminClient()
  if (!admin) {
    console.error('[notify] service-role client unavailable; not sent', params.kind)
    return
  }

  const { error } = await admin.from('notifications').insert({
    user_id: params.userId,
    kind: params.kind,
    title: params.title,
    body: params.body ?? null,
    href: params.href ?? null,
  })

  if (error) console.error('[notify] failed', params.kind, error.message)
}

/** Same notification to several people — used when a job is filled. */
export async function notifyMany(
  userIds: string[],
  params: Omit<Parameters<typeof notify>[0], 'userId'>,
): Promise<void> {
  const admin = createAdminClient()
  if (!admin || userIds.length === 0) return

  const { error } = await admin.from('notifications').insert(
    userIds.map((user_id) => ({
      user_id,
      kind: params.kind,
      title: params.title,
      body: params.body ?? null,
      href: params.href ?? null,
    })),
  )

  if (error) console.error('[notify] bulk failed', params.kind, error.message)
}
