import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { replyToTeam } from '@/lib/adminMessaging'
import { parseBody, z } from '@/lib/validate'
import { rateLimit, callerIp, tooManyRequests } from '@/lib/rateLimit'

// A member's reply into their official TutorMint Team conversation. The reply
// lands in /admin/inbox for the team to read.

const Body = z.object({ body: z.string().min(1, 'Write a reply.').max(4000) })

export async function POST(request: Request) {
  const limit = await rateLimit('report', callerIp(request))
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'messages')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const result = await replyToTeam({ memberId: user.id, body: parsed.data.body ?? '' })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true })
}
