import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activityLog'

// Block or unblock another member.
//
// A block is symmetric in effect and one-sided in knowledge: neither party can
// message or apply to the other afterwards, but the blocked person is never
// told, and RLS lets you read only the blocks YOU created. Telling someone
// they have been blocked is how blocking becomes a fight.
//
// The activity log records both sides -- the blocker's action on their own
// timeline, and "blocked by another member" on the other's -- because the
// admin timeline in T7 needs to be able to explain why two people suddenly
// stopped being able to reach each other.

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  let body: { userId?: string; action?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const target = body.userId
  if (!target || !/^[0-9a-f-]{36}$/i.test(target)) {
    return NextResponse.json({ error: 'Missing member.' }, { status: 400 })
  }
  if (target === user.id) {
    return NextResponse.json({ error: 'You cannot block yourself.' }, { status: 400 })
  }

  if (body.action === 'unblock') {
    const { error } = await supabase
      .from('user_blocks')
      .delete()
      .eq('blocker_id', user.id)
      .eq('blocked_id', target)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await logActivity({ userId: user.id, event: 'unblocked', targetType: 'block', targetId: target })
    return NextResponse.json({ success: true, blocked: false })
  }

  const { error } = await supabase
    .from('user_blocks')
    .upsert({ blocker_id: user.id, blocked_id: target }, { onConflict: 'blocker_id,blocked_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logActivity({ userId: user.id, event: 'blocked', targetType: 'block', targetId: target })
  await logActivity({ userId: target, event: 'blocked_by', targetType: 'blocked_by', targetId: user.id })

  return NextResponse.json({ success: true, blocked: true })
}
