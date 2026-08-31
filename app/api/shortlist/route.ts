import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activityLog'

// Shortlist a tutor, or remove one.
//
// Replaces the localStorage key `tutormint_saved_tutors`, which meant a
// parent's shortlist vanished when they changed device or cleared their
// browser -- and was invisible to us, so nobody could see which tutors parents
// were actually saving.
//
// Auth first, then the write is scoped to the caller: shortlists.user_id is
// taken from the session, never from the request body, so a caller cannot
// write into somebody else's shortlist. RLS on the table (user_id = auth.uid())
// says the same thing again underneath.

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Sign in to shortlist tutors.' }, { status: 401 })
  }

  let body: { tutorId?: string; action?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const tutorId = body.tutorId
  const action = body.action === 'remove' ? 'remove' : 'add'

  if (!tutorId || !/^[0-9a-f-]{36}$/i.test(tutorId)) {
    return NextResponse.json({ error: 'Missing tutor.' }, { status: 400 })
  }
  if (tutorId === user.id) {
    return NextResponse.json({ error: 'You cannot shortlist yourself.' }, { status: 400 })
  }

  if (action === 'remove') {
    const { error } = await supabase
      .from('shortlists')
      .delete()
      .eq('user_id', user.id)
      .eq('tutor_id', tutorId)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await logActivity({
      userId: user.id,
      event: 'shortlist_removed',
      targetType: 'tutor_profile',
      targetId: tutorId,
    })
    return NextResponse.json({ success: true, saved: false })
  }

  // Idempotent: pressing the heart twice must not error.
  const { error } = await supabase
    .from('shortlists')
    .upsert({ user_id: user.id, tutor_id: tutorId }, { onConflict: 'user_id,tutor_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logActivity({
    userId: user.id,
    event: 'shortlist_added',
    targetType: 'tutor_profile',
    targetId: tutorId,
  })

  return NextResponse.json({ success: true, saved: true })
}
