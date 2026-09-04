import { createClient } from '@/lib/supabase/server'
import { decodeCursor, encodeCursor } from '@/lib/cursor'
import type { NotificationKind } from '@/lib/notifications'

// Reading notifications.
//
// Everything here goes through the member's OWN client, never the service role.
// Writing them stays in lib/notifications.ts, which needs the service role
// precisely because there is no insert policy for anyone.
//
// EVERY QUERY FILTERS ON user_id EXPLICITLY, and that is not belt-and-braces.
// The SELECT policy is:
//
//     notifications_own_read:  (user_id = auth.uid()) OR is_admin()
//
// The `OR is_admin()` is there so admin screens can investigate a member's
// account, and it means RLS alone does NOT answer "my notifications" for an
// admin — it answers "every notification on the platform". Leaning on the
// policy here put another member's message notifications in a manager's bell,
// with their own unread count, on the first run. The scope is the caller's own
// id, stated here, and the policy remains the backstop it was written to be.

export type NotificationRow = {
  id: string
  kind: NotificationKind
  title: string
  body: string | null
  href: string | null
  read_at: string | null
  created_at: string
}

/** The filter chips on /account/notifications, and what each covers. */
export const NOTIFICATION_GROUPS = {
  all: [] as string[],
  unread: [] as string[],
  jobs: ['application_received', 'application_withdrawn', 'application_shortlisted', 'application_rejected', 'hired', 'job_filled', 'job_closed', 'job_matched'],
  messages: ['message_received'],
  demos: ['demo_requested', 'demo_accepted', 'demo_declined', 'demo_cancelled', 'demo_feedback'],
  account: [
    'plan_activated',
    'plan_expiring',
    'plan_expired',
    'payment_submitted',
    'payment_rejected',
    'warning_issued',
    'account_suspended',
    'account_reinstated',
    'verification_approved',
    'verification_rejected',
    'profile_address_changed',
    // Visibility: who saw you, and where you stand. Filed under account
    // rather than jobs because neither is about a specific tuition.
    'profile_viewed',
    'rank_dropped',
  ],
} as const

export type NotificationGroup = keyof typeof NOTIFICATION_GROUPS

type NotificationCursor = { c: string; i: string }

export async function unreadCount(): Promise<number> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return 0

  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null)
  return count ?? 0
}

export async function notificationPage({
  group = 'all',
  limit,
  cursor = null,
}: {
  group?: NotificationGroup
  limit: number
  cursor?: string | null
}): Promise<{ rows: NotificationRow[]; nextCursor: string | null }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { rows: [], nextCursor: null }

  let query = supabase
    .from('notifications')
    .select('id, kind, title, body, href, read_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    // created_at alone is not unique: a job being filled notifies every
    // applicant in one insert, so a whole batch shares a timestamp.
    .order('id', { ascending: false })
    .limit(limit)

  if (group === 'unread') query = query.is('read_at', null)
  else if (group !== 'all') {
    query = query.in('kind', NOTIFICATION_GROUPS[group] as unknown as string[])
  }

  const after = decodeCursor<NotificationCursor>(cursor)
  if (after) {
    query = query.or(
      [`created_at.lt."${after.c}"`, `and(created_at.eq."${after.c}",id.lt."${after.i}")`].join(','),
    )
  }

  const { data } = await query
  const rows = (data ?? []) as NotificationRow[]
  const last = rows[rows.length - 1]

  return {
    rows,
    nextCursor:
      rows.length < limit || !last
        ? null
        : encodeCursor({ c: last.created_at, i: last.id } satisfies NotificationCursor),
  }
}

/**
 * Mark the caller's unread notifications as read.
 *
 * Scoped to ids the caller was actually shown, rather than "everything unread":
 * opening the bell should not silently clear a notification that arrived while
 * the panel was open and was never on screen.
 *
 * No user id is passed or trusted — notifications_own_mark_read is what
 * restricts this to the caller's own rows.
 */
export async function markRead(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return 0

  const { data } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .in('id', ids)
    .is('read_at', null)
    .select('id')
  return (data ?? []).length
}
