import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { reportMessage } from '@/lib/messaging'
import { parseBody, z, uuid } from '@/lib/validate'
import { rateLimit, tooManyRequests } from '@/lib/rateLimit'

// Report one message. Writes the message-level record (with a snapshot the admin
// reads instead of the thread) and a row in the shared reports queue. The
// participant check and both writes live in reportMessage.

export const dynamic = 'force-dynamic'

const REASONS = new Set([
  'spam',
  'harassment',
  'fake_profile',
  'off_platform_payment',
  'inappropriate_content',
  'other',
])

const Body = z.object({
  messageId: uuid,
  reason: z.string().min(1).max(40),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to report.' }, { status: 401 })

  const limit = await rateLimit('report', user.id)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'reports')

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const reason = parsed.data.reason
  if (!REASONS.has(reason)) {
    return NextResponse.json({ error: 'Choose a reason for the report.' }, { status: 400 })
  }

  const result = await reportMessage(user.id, parsed.data.messageId, reason)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, message: result.message })
}
