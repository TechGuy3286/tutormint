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
  contentType: z.string().trim().max(100).optional().default(''),
  size: z.number().int().positive(),
  fileName: z.string().trim().max(200).optional().default(''),
})

// The X-Upload-Content-Type sent to YouTube (owner PR6 §1.3). Android Chrome
// often gives file.type = "" or an odd subtype, so: use the client's type when
// it is video/*, otherwise infer from the file extension, otherwise fall back to
// application/octet-stream — never reject the upload for a missing type.
const EXT_TO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  '3gp': 'video/3gpp',
  '3gpp': 'video/3gpp',
  webm: 'video/webm',
}

function resolveContentType(clientType: string, fileName: string): string {
  if (clientType && clientType.startsWith('video/')) return clientType
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  return (ext && EXT_TO_MIME[ext]) || 'application/octet-stream'
}

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

  if (body.size > MAX_VIDEO_BYTES) {
    return NextResponse.json(
      { error: `That video is too large. The limit is ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))} MB.` },
      { status: 413 },
    )
  }

  const session = await createResumableUploadSession({
    // No member name or other personal data in the title (owner PR6 §1.3) —
    // just a short slice of the tutor id.
    title: `TutorMint intro — ${user.id.slice(0, 8)}`,
    description: 'TutorMint tutor introduction video (private, pending review).',
    contentType: resolveContentType(body.contentType, body.fileName),
    contentLength: body.size,
  })
  if (!session.ok) {
    // An account-level cap (uploadLimitExceeded / quota / rate) is not the
    // tutor's video and cannot be fixed by retrying — treat it as temporarily
    // unavailable so the tutor is not told to "choose a different video" in a
    // loop (owner PR6 §1.1/§1.5). Every other failure gets the generic message.
    if (session.accountLimit) {
      return NextResponse.json(
        { error: 'Video upload is temporarily unavailable. Please try again later.', unavailable: true },
        { status: 503 },
      )
    }
    return NextResponse.json({ error: session.error }, { status: 502 })
  }

  return NextResponse.json({ uploadUrl: session.uploadUrl, maxBytes: MAX_VIDEO_BYTES })
}
