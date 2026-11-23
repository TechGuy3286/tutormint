import { NextResponse } from 'next/server'
import { serverError } from '@/lib/errorResponse'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'
import { parseBody, z, text, uuid } from '@/lib/validate'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidateTutorRating } from '@/lib/publicRevalidate'
import { feedbackNotice, feedbackProblem, feedbackWrite } from '@/lib/demoFeedbackCore'

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

  if (!user) return NextResponse.json({ error: 'Please sign in first, then try again.' }, { status: 401 })

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
    if (error) return serverError(error, 'demo/feedback')

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

  const problem = feedbackProblem({ rating: body.rating, text: body.text })
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })
  const rating = Number(body.rating)
  const text = (body.text ?? '').trim()

  const { data: already } = await supabase
    .from('demo_feedback')
    .select('id, parent_id')
    .eq('demo_request_id', body.demoId)
    .maybeSingle()

  // PR-17 D.4: feedback is left once; afterwards Edit updates the same row
  // (stars count at once; an edited comment waits for approval again — the
  // database trigger resets it).
  const write = feedbackWrite(already ? { id: already.id as string, parentId: already.parent_id as string } : null, user.id)
  if (write.kind === 'refuse') {
    return NextResponse.json({ error: 'Feedback has already been left for this demo.' }, { status: 409 })
  }
  if (write.kind === 'update') {
    const { error: upErr } = await supabase
      .from('demo_feedback')
      .update({ rating, feedback_text: text })
      .eq('id', write.id)
      .eq('parent_id', user.id)
    if (upErr) return serverError(upErr, 'demo/feedback')
    await logActivity({
      userId: user.id,
      event: 'demo_feedback_edited',
      targetType: 'demo_feedback',
      targetId: write.id,
      meta: { rating },
    })
    await revalidateTutorRating(demo.tutor_id as string)
    return NextResponse.json({ success: true, id: write.id, updated: true })
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

  if (error) return serverError(error, 'demo/feedback')

  // F.2: the stars, and a tap opens the reviews on the tutor's own profile.
  const admin = createAdminClient()
  const { data: tp } = admin
    ? await admin.from('tutor_profiles').select('slug').eq('id', demo.tutor_id as string).maybeSingle()
    : { data: null }
  await notify({
    userId: demo.tutor_id as string,
    kind: 'demo_feedback',
    ...feedbackNotice(rating, (tp?.slug as string | null) ?? null),
  })

  await logActivity({
    userId: user.id,
    event: 'demo_completed',
    targetType: 'demo_feedback',
    targetId: created.id as string,
    meta: { rating },
  })

  // PR-17 Part B: the stars count at once — rebuild exactly the pages that show
  // this tutor's rating (profile, Browse, their city × subject pages).
  await revalidateTutorRating(demo.tutor_id as string)

  return NextResponse.json({ success: true, id: created.id })
}
