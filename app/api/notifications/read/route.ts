import { NextResponse } from 'next/server'

import { getSessionUser } from '@/lib/auth'
import { markRead, unreadCount } from '@/lib/notificationFeed'
import { parseBody } from '@/lib/validate'
import { z } from 'zod'

// Mark notifications read.
//
// Takes the ids the caller was actually shown rather than "mark everything":
// clearing a notification that arrived while the panel was open, and was never
// on screen, is how somebody misses the message telling them they were hired.
//
// The write itself is the member's own, under notifications_own_mark_read. The
// ids are not a permission — a forged one belonging to somebody else simply
// matches no row.

export const dynamic = 'force-dynamic'

const Schema = z.object({ ids: z.array(z.guid()).max(100) })

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })

  const parsed = await parseBody(request, Schema)
  if (!parsed.ok) return parsed.response

  const updated = await markRead(parsed.data.ids)
  return NextResponse.json({ updated, unread: await unreadCount() })
}
