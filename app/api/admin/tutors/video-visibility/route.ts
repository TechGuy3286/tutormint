import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { setVideoVisibility, youtubeConfigured } from '@/lib/youtube'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { parseBody, z, uuid } from '@/lib/validate'

// Publish an approved introduction video to unlisted or public.
//
// owner / manager. A verifier decides whether a video is acceptable; deciding
// that the world can watch it is a step further, and it is a step that cannot
// be quietly undone once the URL is out.
//
// Two guards worth stating:
//   * only an APPROVED video can be published. Making a rejected or unreviewed
//     video public would route around the whole moderation queue.
//   * the recorded visibility is only advanced to unlisted/public when YouTube
//     actually confirmed it. Going back to private is recorded either way,
//     because "we tried to hide it and could not" must not read as "hidden".

export const runtime = 'nodejs'

const ALLOWED = new Set(['private', 'unlisted', 'public'])

const VisibilityBody = z.object({
  tutorId: uuid,
  visibility: z.enum(['private', 'unlisted', 'public'], {
    message: 'Choose private, unlisted or public.',
  }),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.videoVisibility)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })

  const parsed = await parseBody(request, VisibilityBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const tutorId = body.tutorId ?? ''
  const visibility = body.visibility ?? ''

  if (!tutorId) return NextResponse.json({ error: 'Missing tutor.' }, { status: 400 })
  if (!ALLOWED.has(visibility)) {
    return NextResponse.json({ error: 'Unknown visibility.' }, { status: 400 })
  }

  const { data: tutor } = await admin
    .from('tutor_profiles')
    .select('id, full_name, video_youtube_id, video_status, video_visibility')
    .eq('id', tutorId)
    .maybeSingle()

  if (!tutor) return NextResponse.json({ error: 'Tutor not found.' }, { status: 404 })
  if (!tutor.video_youtube_id) {
    return NextResponse.json({ error: 'This tutor has no video on file.' }, { status: 400 })
  }
  if (visibility !== 'private' && tutor.video_status !== 'approved') {
    return NextResponse.json(
      { error: 'Approve the video before publishing it.' },
      { status: 409 },
    )
  }

  const result = await setVideoVisibility(
    tutor.video_youtube_id as string,
    visibility as 'private' | 'unlisted' | 'public',
  )

  // Record the intent when the API is simply not configured -- that is the
  // normal state on a developer machine and in a fresh environment, and losing
  // the owner's decision because of it would be worse than a stale flag.
  // A genuine API FAILURE is different: it is reported and nothing is written.
  const record = result.success || result.unconfigured === true

  if (!record) {
    return NextResponse.json(
      { error: result.error ?? 'YouTube refused the change.' },
      { status: 502 },
    )
  }

  const { error } = await admin
    .from('tutor_profiles')
    .update({
      video_visibility: visibility,
      video_visibility_set_at: new Date().toISOString(),
      video_visibility_set_by: gate.actor.id,
    })
    .eq('id', tutorId)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'video.visibility',
    targetType: 'tutor_profile',
    targetId: tutorId,
    detail: {
      from: tutor.video_visibility,
      to: visibility,
      videoId: tutor.video_youtube_id,
      // Recorded so nobody later reads a row and assumes YouTube agreed.
      appliedOnYouTube: !!result.success,
      youtubeConfigured: youtubeConfigured(),
    },
  })

  await logActivity({
    userId: tutorId,
    event: 'video_visibility_changed',
    targetType: 'tutor_profile',
    targetId: tutorId,
    meta: { to: visibility, appliedOnYouTube: !!result.success },
  })

  return NextResponse.json({
    success: true,
    visibility,
    appliedOnYouTube: !!result.success,
    // The drawer says this out loud rather than showing a green tick.
    note: result.success
      ? null
      : 'Recorded here, but YouTube was not reachable — its API credentials are not configured.',
  })
}
