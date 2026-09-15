import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { unreadMessageCount } from '@/lib/messaging'

// Unread message count for this member — the same source the header bell and the
// dashboard tile use (message_received notifications + Team). Read by the header
// chat icon (PR 4 §3) and the messages dock (§2) to refresh on focus/open.

export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ count: 0 }, { status: 401 })
  const count = await unreadMessageCount(user.id)
  return NextResponse.json({ count }, { headers: { 'Cache-Control': 'no-store' } })
}
