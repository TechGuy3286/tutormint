import { NextResponse } from 'next/server'

import { getSessionUser } from '@/lib/auth'
import {
  NOTIFICATION_GROUPS,
  notificationPage,
  unreadCount,
  type NotificationGroup,
} from '@/lib/notificationFeed'

// The caller's own notifications.
//
// No user id is accepted from the request, and none is needed: every query
// runs through the caller's session and notifications_own_read is what decides
// whose rows come back. A route that took an id would be a route that could be
// asked for somebody else's.

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })

  const url = new URL(request.url)
  const raw = (url.searchParams.get('group') ?? 'all') as NotificationGroup
  const group = raw in NOTIFICATION_GROUPS ? raw : 'all'

  const [{ rows, nextCursor }, unread] = await Promise.all([
    notificationPage({
      group,
      limit: PAGE_SIZE,
      cursor: (url.searchParams.get('cursor') ?? '').trim() || null,
    }),
    unreadCount(),
  ])

  return NextResponse.json({ items: rows, cursor: nextCursor, unread })
}
