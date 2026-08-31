import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createClient } from '@/lib/supabase/server'
import { recomputeCompletion } from '@/lib/completion'

// Tutor introduction video.
//
// Was completely unauthenticated: anyone could POST a file and have it
// uploaded to the official YouTube channel. Now:
//   * requires a session AND profiles.role = 'tutor'
//   * counts attempts, hard cap of 3 (tutor_profiles.video_attempts)
//   * uploads PRIVATE, records video_youtube_id + video_status='uploaded'
//   * when YOUTUBE_* env vars are missing it degrades honestly -- it reports
//     which vars are absent and does NOT record a submission. Nothing is faked.

export const runtime = 'nodejs'

const MAX_ATTEMPTS = 3
const REQUIRED_ENV = [
  'YOUTUBE_CLIENT_ID',
  'YOUTUBE_CLIENT_SECRET',
  'YOUTUBE_REDIRECT_URI',
  'YOUTUBE_REFRESH_TOKEN',
] as const

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })
  }

  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (me?.role !== 'tutor') {
    return NextResponse.json({ error: 'Only tutors can upload an introduction video.' }, { status: 403 })
  }

  const { data: tp } = await supabase
    .from('tutor_profiles')
    .select('video_attempts, video_status')
    .eq('id', user.id)
    .maybeSingle()

  const attempts = tp?.video_attempts ?? 0
  if (attempts >= MAX_ATTEMPTS) {
    return NextResponse.json(
      {
        error: 'You have used all 3 video submissions.',
        locked: true,
        supportEmail: 'support@tutormint.org',
      },
      { status: 429 },
    )
  }

  const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k])
  if (missingEnv.length > 0) {
    // Degrade honestly: no attempt is consumed and nothing is marked submitted.
    return NextResponse.json(
      {
        error: 'Video upload is temporarily unavailable.',
        unavailable: true,
        submitted: false,
        missingEnv,
        detail: `The server is missing: ${missingEnv.join(', ')}.`,
      },
      { status: 503 },
    )
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 })
  }

  const file = formData.get('video')
  const title = String(formData.get('title') ?? `TutorMint intro — ${user.id}`)
  const description = String(formData.get('description') ?? 'TutorMint tutor introduction video.')

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Choose a video file.' }, { status: 400 })
  }

  let tempFilePath: string | null = null
  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    tempFilePath = path.join(os.tmpdir(), `${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`)
    fs.writeFileSync(tempFilePath, buffer)

    // Imported lazily so a missing/broken googleapis install cannot take down
    // the whole route module at import time.
    const { uploadVideoToDrafts } = await import('@/lib/youtube')
    const result = await uploadVideoToDrafts({ filePath: tempFilePath, title, description })

    const videoId =
      (result as { id?: string; data?: { id?: string } })?.id ??
      (result as { data?: { id?: string } })?.data?.id ??
      null

    if (!videoId) {
      return NextResponse.json(
        { error: 'YouTube did not return a video id. Nothing was recorded.', submitted: false },
        { status: 502 },
      )
    }

    await supabase
      .from('tutor_profiles')
      .update({
        video_youtube_id: videoId,
        video_status: 'uploaded',
        video_attempts: attempts + 1,
      })
      .eq('id', user.id)

    const completion = await recomputeCompletion(user.id)

    return NextResponse.json({
      success: true,
      submitted: true,
      videoId,
      attempt: attempts + 1,
      attemptsLeft: MAX_ATTEMPTS - (attempts + 1),
      completion: completion?.percent ?? null,
    })
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Video upload failed.',
        submitted: false,
      },
      { status: 500 },
    )
  } finally {
    if (tempFilePath) {
      try {
        fs.unlinkSync(tempFilePath)
      } catch {
        // Best effort: the OS clears its temp dir anyway.
      }
    }
  }
}
