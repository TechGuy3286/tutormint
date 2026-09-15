import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { recomputeCompletion } from '@/lib/completion'
import { logActivity } from '@/lib/activityLog'
import { parseBody, z } from '@/lib/validate'
import { verifyOwnUploadedVideo } from '@/lib/youtube'

// Record a resumable-uploaded introduction video.
//
// The browser has already PUT the bytes to the session URL from
// /api/tutor/video/session; it now reports the returned video id. We VERIFY the
// id is a private upload on our own channel (a private video is visible to our
// credentials only if it is ours — see lib/youtube), so a client cannot mark
// itself submitted with a foreign id, then record it exactly as the old direct
// upload did: video_youtube_id + video_status='uploaded' + one attempt consumed.

export const runtime = 'nodejs'

const MAX_ATTEMPTS = 3

// A YouTube video id is 11 URL-safe base64 chars.
const Body = z.object({
  videoId: z.string().trim().regex(/^[A-Za-z0-9_-]{11}$/, 'That is not a valid video id.'),
})

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (me?.role !== 'tutor') {
    return NextResponse.json({ error: 'Only tutors can upload an introduction video.' }, { status: 403 })
  }

  const { data: tp } = await supabase
    .from('tutor_profiles')
    .select('video_attempts')
    .eq('id', user.id)
    .maybeSingle()
  const attempts = tp?.video_attempts ?? 0
  if (attempts >= MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: 'You have used all 3 video submissions.', locked: true, supportEmail: 'support@tutormint.org' },
      { status: 429 },
    )
  }

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const { videoId } = parsed.data

  const verified = await verifyOwnUploadedVideo(videoId)
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error, submitted: false }, { status: 400 })
  }

  const { error } = await supabase
    .from('tutor_profiles')
    .update({
      video_youtube_id: videoId,
      video_status: 'uploaded',
      video_attempts: attempts + 1,
    })
    .eq('id', user.id)
  if (error) return NextResponse.json({ error: error.message, submitted: false }, { status: 400 })

  await logActivity({
    userId: user.id,
    event: 'video_submitted',
    targetType: 'tutor_profile',
    targetId: user.id,
    meta: { attempt: attempts + 1, videoId },
  })

  const completion = await recomputeCompletion(user.id)

  return NextResponse.json({
    success: true,
    submitted: true,
    videoId,
    attempt: attempts + 1,
    attemptsLeft: MAX_ATTEMPTS - (attempts + 1),
    completion: completion?.percent ?? null,
  })
}
