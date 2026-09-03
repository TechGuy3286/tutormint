import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { markThreadRead } from '@/lib/messaging'

// "I have opened this conversation."
//
// A POST from the browser rather than a write during the page's own render,
// and the distinction matters: Next prefetches links, so marking read while
// rendering would clear the unread dot for conversations a member only
// hovered over. This fires when the pane has actually mounted in front of
// somebody.
//
// It clears `notifications` rows, which is where unread lives -- so the dot in
// the list and the count on the header bell move together, because they are
// reading the same rows. `markThreadRead` goes through the member's own client
// and the UPDATE policy is `user_id = auth.uid()`, so the database refuses to
// clear anybody else's.
//
// Deliberately NOT logged to the activity timeline. It is a read receipt, not
// a state change, and a timeline that records opening a conversation is a
// timeline nobody can find the hires in. Same reasoning as the bell's own
// mark-read, and the same departure from rule 11, flagged there too.

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  let threadId = ''
  try {
    const body = (await request.json()) as { threadId?: string }
    threadId = body.threadId ?? ''
  } catch {
    return NextResponse.json({ error: 'Missing conversation.' }, { status: 400 })
  }

  if (!/^[0-9a-f-]{36}$/i.test(threadId)) {
    return NextResponse.json({ error: 'Missing conversation.' }, { status: 400 })
  }

  await markThreadRead(user.id, threadId)
  return NextResponse.json({ success: true })
}
