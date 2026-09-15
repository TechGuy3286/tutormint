import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseBody, z } from '@/lib/validate'
import {
  createResumableUploadSession,
  youtubeConfigured,
  MAX_VIDEO_BYTES,
} from '@/lib/youtube'

// Issue a resumable YouTube upload session for the tutor's introduction video.
//
// The browser PUTs the video bytes STRAIGHT to the session URL this returns, so
// a real (large) video never passes through the Vercel serverless body cap
// (~4.5 MB) — the reason the old 4 MB limit existed (PR 3b §4). This route only
// mints the session; /api/tutor/video/record records the result afterwards.
//
// No attempt is consumed here (issuing a session is free and repeatable); the
// 3-submission cap bites when a video is actually recorded.

export const runtime = 'nodejs' // googleapis needs the Node runtime

const MAX_ATTEMPTS = 3

const Body = z.object({
  contentType: z.string().trim().max(100).optional().default('video/mp4'),
  size: z.number().int().positive(),
  fileName: z.string().trim().max(200).optional().default(''),
})

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

  const { data: me } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).maybeSingle()
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

  if (!youtubeConfigured()) {
    // Degrade honestly, like the old route: nothing is faked, no attempt used.
    return NextResponse.json(
      { error: 'Video upload is temporarily unavailable.', unavailable: true },
      { status: 503 },
    )
  }

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  if (!body.contentType.startsWith('video/')) {
    return NextResponse.json({ error: 'Choose a video file (MP4 or MOV).' }, { status: 400 })
  }
  if (body.size > MAX_VIDEO_BYTES) {
    return NextResponse.json(
      { error: `That video is too large. The limit is ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))} MB.` },
      { status: 413 },
    )
  }

  const session = await createResumableUploadSession({
    title: `TutorMint intro — ${(me?.full_name as string) || user.id}`,
    description: 'TutorMint tutor introduction video (private, pending review).',
    contentType: body.contentType,
    contentLength: body.size,
  })
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: 502 })
  }

  return NextResponse.json({ uploadUrl: session.uploadUrl, maxBytes: MAX_VIDEO_BYTES })
}
