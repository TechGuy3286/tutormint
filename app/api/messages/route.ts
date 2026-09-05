import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendMessage } from '@/lib/messaging'
import { parseBody, z, text, uuid } from '@/lib/validate'
import { rateLimit, callerIp, tooManyRequests } from '@/lib/rateLimit'

// Post a message into an existing thread.
//
// Replying is always allowed to a participant, whatever their plan -- only
// OPENING a thread is plan-gated. The body is stored verbatim; masking happens
// when it is read, so the same message unmasks by itself if the reader's plan
// later grants contact rights.

const MessageBody = z.object({
  threadId: uuid,
  // Optional because a photo message may carry no text; sendMessage enforces
  // "a body OR an attachment".
  body: z.string().max(4000, 'Message is too long (4000 characters max).').optional(),
  replyTo: uuid.nullish(),
  attachment: z
    .object({
      path: z.string().min(1).max(400),
      w: z.number().int().nonnegative(),
      h: z.number().int().nonnegative(),
      bytes: z.number().int().positive(),
    })
    .nullish(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in to send a message.' }, { status: 401 })

  const limit = await rateLimit('message', user.id)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'messages')

  const parsed = await parseBody(request, MessageBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  if (!body.threadId) return NextResponse.json({ error: 'Missing conversation.' }, { status: 400 })

  const result = await sendMessage({
    actorId: user.id,
    threadId: body.threadId,
    body: body.body ?? '',
    replyTo: body.replyTo ?? null,
    attachment: body.attachment ?? null,
  })

  if (!result.ok) return NextResponse.json({ error: result.error, gate: result.gate }, { status: result.status })
  return NextResponse.json({ success: true, messageId: result.messageId })
}
