import { NextResponse } from 'next/server'
import { serverError } from '@/lib/errorResponse'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'
import { parseBody, z, uuid } from '@/lib/validate'
import { demoCompletedNotice } from '@/lib/demoFeedbackCore'

// Either participant marks an accepted demo as having happened.
//
// Either side, because a demo is held off-platform and whoever remembers first
// should be able to close it out. Marking it complete is what unlocks the
// parent's feedback form.

const CompleteBody = z.object({
  demoId: uuid,
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Please sign in first, then try again.' }, { status: 401 })

  const parsed = await parseBody(request, CompleteBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

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

  if (error) return serverError(error, 'demo/complete')

  // F.1 (PR-17): the tutor is told "Demo completed"; only the parent gets the
  // feedback prompt (lib/demoFeedbackCore demoCompletedNotice).
  const toTutor = demo.parent_id === user.id
  await notify({
    userId: toTutor ? (demo.tutor_id as string) : (demo.parent_id as string),
    kind: 'demo_feedback',
    ...demoCompletedNotice(toTutor ? 'tutor' : 'parent'),
  })

  await logActivity({
    userId: user.id,
    event: 'demo_completed',
    targetType: 'demo_request',
    targetId: body.demoId,
  })

  return NextResponse.json({ success: true, status: 'completed' })
}
