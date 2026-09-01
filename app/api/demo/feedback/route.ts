import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'
import { parseBody, z, text, uuid } from '@/lib/validate'

// Feedback after a demo: the parent writes it, the tutor may reply once.
//
// Feedback is tied to a completed demo between exactly those two people, so it
// cannot be left by somebody who never met the tutor. It is public on the
// tutor's profile, which is why the tutor gets a right of reply.

const FeedbackBody = z.object({
  demoId: uuid,
  rating: z.coerce
    .number()
    .int('Give a whole number of stars.')
    .min(1, 'Give a rating from 1 to 5.')
    .max(5, 'Give a rating from 1 to 5.')
    .optional(),
  text: z.string().max(2000, 'Keep your feedback under 2000 characters.').optional(),
  reply: z.string().max(2000, 'Keep your reply under 2000 characters.').optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  const parsed = await parseBody(request, FeedbackBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  if (!body.demoId) return NextResponse.json({ error: 'Missing demo.' }, { status: 400 })

  const { data: demo } = await supabase
    .from('demo_requests')
    .select('id, parent_id, tutor_id, status')
    .eq('id', body.demoId)
    .maybeSingle()

  if (!demo) return NextResponse.json({ error: 'Demo request not found.' }, { status: 404 })

  // The tutor replying to feedback already left.
  if (demo.tutor_id === user.id) {
    const reply = (body.reply ?? '').trim()
    if (!reply) return NextResponse.json({ error: 'Write your reply first.' }, { status: 400 })

    const { data: existing } = await supabase
      .from('demo_feedback')
      .select('id, tutor_reply')
      .eq('demo_request_id', body.demoId)
      .maybeSingle()

    if (!existing) {
      return NextResponse.json({ error: 'There is no feedback to reply to yet.' }, { status: 404 })
    }
    if (existing.tutor_reply) {
      return NextResponse.json({ error: 'You have already replied.' }, { status: 409 })
    }

    const { error } = await supabase
      .from('demo_feedback')
      .update({ tutor_reply: reply })
      .eq('id', existing.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ success: true, replied: true })
  }

  // The parent leaving feedback.
  if (demo.parent_id !== user.id) {
    return NextResponse.json({ error: 'Demo request not found.' }, { status: 404 })
  }
  if (demo.status !== 'completed') {
    return NextResponse.json(
      { error: 'Mark the demo as completed before leaving feedback.' },
      { status: 400 },
    )
  }

  const rating = Number(body.rating)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'Give a rating from 1 to 5.' }, { status: 400 })
  }
  const text = (body.text ?? '').trim()
  if (text.length < 5) {
    return NextResponse.json({ error: 'Write a sentence about how it went.' }, { status: 400 })
  }

  const { data: already } = await supabase
    .from('demo_feedback')
    .select('id')
    .eq('demo_request_id', body.demoId)
    .maybeSingle()

  if (already) {
    return NextResponse.json(
      { error: 'Feedback has already been left for this demo.' },
      { status: 409 },
    )
  }

  const { data: created, error } = await supabase
    .from('demo_feedback')
    .insert({
      demo_request_id: body.demoId,
      parent_id: user.id,
      tutor_id: demo.tutor_id,
      rating,
      feedback_text: text,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await notify({
    userId: demo.tutor_id as string,
    kind: 'demo_feedback',
    title: 'You received demo feedback',
    body: `${rating} out of 5`,
    href: '/tutor/dashboard',
  })

  await logActivity({
    userId: user.id,
    event: 'demo_completed',
    targetType: 'demo_feedback',
    targetId: created.id as string,
    meta: { rating },
  })

  return NextResponse.json({ success: true, id: created.id })
}
