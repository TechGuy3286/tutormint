import { createClient } from '@/lib/supabase/server'

// Re-exported so existing callers keep one import site; the definitions live
// in lib/feedGrouping.ts, which client components can also reach.
export { groupFeed } from '@/lib/feedGrouping'
export type { FeedItem, FeedGroup } from '@/lib/feedGrouping'
import type { FeedItem } from '@/lib/feedGrouping'

// The ACTIVITY band: what has actually happened, newest first.
//
// Two sources, because neither is complete on its own. `notifications` holds
// the things the platform decided were worth telling this member and already
// carries a correct `href` written at the moment of the event -- that is the
// most reliable link we will ever have to the thing an item is about.
// `user_activity_log` holds what the member themselves did, which never
// generates a notification (nobody is notified of their own actions) and is
// otherwise invisible to them.
//
// NOTHING IS INVENTED. Every row corresponds to a row in one of those two
// tables. Where an event has no honest destination the row still renders and
// simply is not a link -- a plausible-looking link that lands on the wrong page
// is worse than no link, because it teaches people not to trust the band.
//
// WHY user_id IS FILTERED EXPLICITLY. Both tables carry a SELECT policy of the
// form `user_id = auth.uid() OR is_admin...`, added so admin screens can
// investigate an account. Leaning on RLS to scope "my activity" therefore
// hands an admin every member's rows in their own feed -- exactly the bug the
// notification bell shipped with and had to be fixed for. The policy is the
// backstop; the query is the control.

/**
 * Member-facing labels for the events worth showing on someone's own dashboard.
 *
 * This is NOT the map in /admin/users/[id]. That one is written in the third
 * person for a moderator reading a stranger's timeline ("Posted a job"); this
 * one addresses the member ("You posted a tuition"). Same events, different
 * reader — merging them would mean one of the two audiences reads the wrong
 * voice, and the admin timeline is the one that must stay neutral.
 *
 * An event ABSENT from this map is not shown. That is the filter, and it is
 * deliberate: `login` alone accounts for more rows than every other event
 * combined, and a band that opens with four sign-ins tells the member nothing
 * they did not already know.
 */
const LABEL: Record<string, string> = {
  job_posted: 'You posted a tuition',
  job_edited: 'You edited a tuition',
  job_closed: 'You closed a tuition',
  application_submitted: 'You applied for a tuition',
  application_withdrawn: 'You withdrew an application',
  demo_requested: 'You requested a demo',
  demo_accepted: 'A demo was accepted',
  demo_declined: 'A demo was declined',
  demo_completed: 'A demo was completed',
  message_sent: 'You sent a message',
  shortlist_added: 'You shortlisted a tutor',
  shortlist_removed: 'You removed a shortlist',
  verification_submitted: 'You submitted your verification',
  verification_decision_received: 'A verification decision was made',
  video_submitted: 'You submitted an introduction video',
  document_uploaded: 'You uploaded a document',
  payment_submitted: 'You started a payment',
  payment_rejected: 'A payment was not approved',
  plan_purchased: 'Your plan started',
  plan_granted: 'A plan was added to your account',
  plan_expiring: 'Your plan is close to expiring',
  plan_expired: 'Your plan ended',
  plan_revoked: 'Your plan was removed',
  suspended: 'Your account was suspended',
  unsuspended: 'Your account was reinstated',
  warned: 'You received a warning',
  profile_claimed: 'You claimed your profile',
  email_confirmed: 'You confirmed your email address',
}

// Deliberately absent, and why:
//
//   login, registered, otp_verified, search_performed, profile_viewed,
//   profile_updated, completion_changed, subjects_changed, password_changed,
//   terms_accepted, email_preferences_changed, imported
//       -- routine or self-evident; they would bury the rest.
//
//   blocked_by, reported_by
//       -- these exist so a moderator can see both sides of an incident. On
//          the member's own dashboard "you were reported" tells somebody they
//          are under scrutiny, which is not information a report subject
//          should get before a moderator has looked. CLAUDE.md already keeps
//          the reporter's name out of that row; this keeps the row itself out
//          of the reported member's view.
//
//   staff_*, video_visibility_changed, report_resolved
//       -- admin lifecycle, not the member's own doing.

/** Where an activity row points, or null when there is no honest destination. */
function hrefFor(
  event: string,
  targetType: string | null,
  targetId: string | null,
  role: string | null,
): string | null {
  const isTutor = role === 'tutor'

  switch (event) {
    case 'job_posted':
    case 'job_edited':
    case 'job_closed':
      return targetId ? `/parent/dashboard/job/${targetId}` : '/parent/dashboard/jobs'
    case 'application_submitted':
    case 'application_withdrawn':
      return '/tutor/dashboard/applications'
    case 'demo_requested':
    case 'demo_accepted':
    case 'demo_declined':
    case 'demo_completed':
      return isTutor ? '/tutor/dashboard/demos' : '/parent/dashboard/demos'
    case 'message_sent':
      // target_type 'thread' -- the id is the thread, never the message, and
      // the body is never stored on the timeline in the first place.
      return targetType === 'thread' && targetId ? `/messages/${targetId}` : null
    case 'verification_submitted':
    case 'verification_decision_received':
      return isTutor ? '/tutor/dashboard/settings' : '/parent/verify'
    case 'video_submitted':
      return '/tutor/upload-youtube'
    case 'payment_submitted':
    case 'payment_rejected':
    case 'plan_purchased':
    case 'plan_granted':
    case 'plan_expiring':
    case 'plan_expired':
    case 'plan_revoked':
      return isTutor ? '/tutor/packages' : '/parent/packages'
    case 'suspended':
    case 'unsuspended':
    case 'warned':
      return '/support'
    default:
      // shortlist_added/removed, document_uploaded, profile_claimed,
      // email_confirmed: real events with nowhere specific to go. There is no
      // shortlists screen, so linking one would be a guess.
      return null
  }
}

/**
 * The SAME happening, named differently by each source.
 *
 * Reinstating an account writes `unsuspended` to user_activity_log and
 * `account_reinstated` to notifications, about a second apart. Both are real
 * rows, so neither can simply be dropped from its table — but showing a member
 * "Your account was reinstated" directly above "Your account has been
 * reinstated" makes the band look broken, and same-type grouping never catches
 * it because the types differ.
 *
 * Anything that maps to the same string here is one happening. Events NOT in
 * this table are never merged, which matters more than it looks:
 * `application_submitted` (a tutor applying) and `application_received` (the
 * parent being told) describe one event from two sides, but they land on two
 * DIFFERENT people's feeds and must both survive.
 */
const CANONICAL: Record<string, string> = {
  unsuspended: 'reinstated',
  account_reinstated: 'reinstated',
  suspended: 'suspended',
  account_suspended: 'suspended',
  warned: 'warned',
  warning_issued: 'warned',
  plan_purchased: 'plan_started',
  plan_granted: 'plan_started',
  plan_activated: 'plan_started',
  plan_expired: 'plan_ended',
  payment_submitted: 'payment_started',
  payment_rejected: 'payment_rejected',
  verification_decision_received: 'verification_decision',
  verification_approved: 'verification_decision',
  verification_rejected: 'verification_decision',
}

/** How close two rows must be to be the same happening. */
const DEDUPE_WINDOW_MS = 5 * 60 * 1000

/**
 * Collapse one happening reported by both sources into a single row.
 *
 * THE NOTIFICATION WINS. It carries an href written at the moment of the
 * event, which the activity row usually cannot reconstruct, and it is phrased
 * for the member rather than derived from an event name. The activity row is
 * kept only when no notification accompanies it.
 *
 * Notifications carry no target_type/target_id, so the pairing key is the
 * canonical event plus the time window rather than the target. Within five
 * minutes, on one member's own feed, two rows naming the same happening are
 * the same happening — and the alternative, showing both, is the bug.
 */
function dedupeAcrossSources(items: FeedItem[]): FeedItem[] {
  const kept: FeedItem[] = []

  for (const item of items) {
    const key = CANONICAL[item.type]
    if (!key) {
      kept.push(item)
      continue
    }

    const twinIndex = kept.findIndex(
      (k) =>
        CANONICAL[k.type] === key &&
        Math.abs(new Date(k.at).getTime() - new Date(item.at).getTime()) <= DEDUPE_WINDOW_MS,
    )

    if (twinIndex === -1) {
      kept.push(item)
      continue
    }

    // A notification replaces an activity row in place, so the merged row keeps
    // its position in the timeline and gains the link.
    if (item.source === 'notification' && kept[twinIndex].source === 'activity') {
      kept[twinIndex] = item
    }
  }

  return kept
}

/**
 * The merged feed for one member, newest first.
 *
 * Each source is read at `limit` and the merge is truncated back to `limit`,
 * so a burst on one side cannot crowd the other out of the window entirely
 * while still costing only two bounded queries.
 */
export async function recentActivity({
  userId,
  role,
  limit = 8,
}: {
  userId: string
  role: string | null
  limit?: number
}): Promise<FeedItem[]> {
  const supabase = await createClient()

  const [{ data: notes }, { data: acts }] = await Promise.all([
    supabase
      .from('notifications')
      .select('id, kind, title, href, read_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      // Over-fetch: de-duplication removes rows, and a window that ends up
      // short would silently show fewer than asked for.
      .limit(limit * 2),
    supabase
      .from('user_activity_log')
      .select('id, event, target_type, target_id, created_at')
      .eq('user_id', userId)
      .in('event', Object.keys(LABEL))
      .order('created_at', { ascending: false })
      .limit(limit * 2),
  ])

  const items: FeedItem[] = [
    ...(notes ?? []).map((n) => ({
      id: `n-${n.id as string}`,
      source: 'notification' as const,
      type: (n.kind as string) ?? 'notification',
      text: n.title as string,
      href: (n.href as string) ?? null,
      at: n.created_at as string,
      unread: !n.read_at,
    })),
    ...(acts ?? []).map((a) => ({
      id: `a-${a.id as string}`,
      source: 'activity' as const,
      type: a.event as string,
      text: LABEL[a.event as string] ?? (a.event as string),
      href: hrefFor(
        a.event as string,
        (a.target_type as string) ?? null,
        (a.target_id as string) ?? null,
        role,
      ),
      at: a.created_at as string,
      unread: false,
    })),
  ]

  items.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime())
  return dedupeAcrossSources(items).slice(0, limit)
}

