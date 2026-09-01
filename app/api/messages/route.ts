import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendMessage } from '@/lib/messaging'

// Post a message into an existing thread.
//
// Replying is always allowed to a participant, whatever their plan -- only
// OPENING a thread is plan-gated. The body is stored verbatim; masking happens
// when it is read, so the same message unmasks by itself if the reader's plan
// later grants contact rights.

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in to send a message.' }, { status: 401 })

  let body: { threadId?: string; body?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!body.threadId) return NextResponse.json({ error: 'Missing conversation.' }, { status: 400 })

  const result = await sendMessage({
    actorId: user.id,
    threadId: body.threadId,
    body: body.body ?? '',
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, messageId: result.messageId })
}
