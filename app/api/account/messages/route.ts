import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { replyToTeam, markTeamMessagesRead } from '@/lib/adminMessaging'
import { parseBody, z } from '@/lib/validate'
import { rateLimit, callerIp, tooManyRequests } from '@/lib/rateLimit'

// The member's side of the official TutorMint Team conversation, which now lives
// inside the role inbox (owner, Part 5). Two actions:
//
//   reply    — post a reply; it lands in /admin/inbox for the team to read.
//   markRead — the member opened the Team pane: clear the Team's unread 'out'
//              messages AND the matching admin_message notifications, so the
//              pinned row's dot, the bell and the dashboard tile all drop.

const Body = z.object({
  action: z.enum(['reply', 'markRead']).optional().default('reply'),
  body: z.string().max(4000).optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const { action, body } = parsed.data

  if (action === 'markRead') {
    // admin_messages has no member UPDATE policy, so the 'out' read stamp is a
    // service-role write (in adminMessaging). The notifications are cleared with
    // the member's OWN client — notifications_own_mark_read scopes it to them.
    await markTeamMessagesRead(user.id)
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('kind', 'admin_message')
      .is('read_at', null)
    return NextResponse.json({ success: true })
  }

  // reply
  const limit = await rateLimit('report', callerIp(request))
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'messages')

  const text = (body ?? '').trim()
  if (text.length < 1) return NextResponse.json({ error: 'Write a reply.' }, { status: 400 })

  const result = await replyToTeam({ memberId: user.id, body: text })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true })
}
