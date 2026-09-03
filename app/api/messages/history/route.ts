import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { messagePage } from '@/lib/messaging'

// Older messages in one conversation.
//
// Paging UPWARDS: the newest window is server-rendered with the page, and this
// hands back what came before it. `messagePage` returns null when the caller is
// not a participant, and that becomes a 404 -- the same answer a made-up id
// gets, so nobody can use this route to find out whether a conversation exists.
//
// Bodies come back already masked when the pair may not exchange numbers. The
// digits are not sent and then hidden; they are not sent.

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 30

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in to read your messages.' }, { status: 401 })

  const url = new URL(request.url)
  const threadId = url.searchParams.get('threadId') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(threadId)) {
    return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
  }

  const page = await messagePage({
    userId: user.id,
    threadId,
    limit: PAGE_SIZE,
    cursor: url.searchParams.get('cursor'),
  })

  if (!page) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
  return NextResponse.json(page)
}
