import { NextResponse } from 'next/server'
import { markAllRead } from '@/lib/notificationFeed'

// "Mark all read" — clears every unread notification for the caller and returns
// the fresh count (0). notifications_own_mark_read scopes the write to the
// caller's own rows; no id is passed or trusted.

export const dynamic = 'force-dynamic'

export async function POST() {
  const cleared = await markAllRead()
  return NextResponse.json({ cleared, unread: 0 })
}
