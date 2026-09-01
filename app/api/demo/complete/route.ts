import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'

// Either participant marks an accepted demo as having happened.
//
// Either side, because a demo is held off-platform and whoever remembers first
// should be able to close it out. Marking it complete is what unlocks the
// parent's feedback form.

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  let body: { demoId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!body.demoId) return NextResponse.json({ error: 'Missing demo.' }, { status: 400 })

  const { data: demo } = await supabase
    .from('demo_requests')
    .select('id, parent_id, tutor_id, status')
    .eq('id', body.demoId)
    .maybeSingle()

  if (!demo || (demo.parent_id !== user.id && demo.tutor_id !== user.id)) {
    return NextResponse.json({ error: 'Demo request not found.' }, { status: 404 })
  }
  if (demo.status !== 'accepted') {
    return NextResponse.json(
      { error: 'Only an accepted demo can be marked as completed.' },
      { status: 400 },
    )
  }

  const { error } = await supabase
    .from('demo_requests')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', body.demoId)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const other = demo.parent_id === user.id ? (demo.tutor_id as string) : (demo.parent_id as string)
  await notify({
    userId: other,
    kind: 'demo_feedback',
    title: 'A demo was marked as completed',
    body: 'Feedback can now be left.',
    href: demo.parent_id === user.id ? '/tutor/dashboard' : '/parent/dashboard',
  })

  await logActivity({
    userId: user.id,
    event: 'demo_completed',
    targetType: 'demo_request',
    targetId: body.demoId,
  })

  return NextResponse.json({ success: true, status: 'completed' })
}
