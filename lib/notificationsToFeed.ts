import type { FeedItem } from '@/lib/feedGrouping'
import type { NotificationRow } from '@/lib/notificationFeed'

// One shape for the activity card, wherever it renders.
//
// /account/notifications reads `notifications` directly and the dashboards
// read a merge of that table and user_activity_log. Rather than give the card
// two prop shapes to understand -- which is how the two surfaces start looking
// different -- the notification rows are lifted into the same FeedItem the
// dashboards already produce, and both go through groupFeed and ActivityCard.
//
// `source` is 'notification' for every row here by definition, and `type` is
// the notification kind, which is what the colour families and the grouped
// phrasing key on.

export function notificationsToFeed(rows: NotificationRow[]): FeedItem[] {
  return rows.map((n) => ({
    id: n.id,
    source: 'notification' as const,
    type: n.kind,
    text: n.title,
    href: n.href,
    at: n.created_at,
    unread: !n.read_at,
  }))
}
