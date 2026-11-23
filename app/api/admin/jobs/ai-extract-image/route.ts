import { NextResponse } from 'next/server'

import { checkAdminRole, roleMayWrite, SCREEN_ACCESS } from '@/lib/adminAuth'
import { rateLimit } from '@/lib/rateLimit'
import { extractTuitionFromImage } from '@/lib/imageRead'
import { AI_CAP_REACHED } from '@/lib/aiTuitionExtractCore'
import { IMAGE_MAX_BYTES, IMAGE_TOO_BIG, IMAGE_WRONG_TYPE, imageTypeOk } from '@/lib/imageMaskCore'

// POST /api/admin/jobs/ai-extract-image (multipart, field "image") — "Read
// from image" on staff Post a tuition (owner, 24 Nov 2026 — PR-20 Part C).
// The image is read in memory: plain OCR finds the phone numbers and they are
// blacked out BEFORE the AI sees it (lib/imageRead); the masked image is
// checked again and the AI is not called if a number is still readable. The
// numbers found come back for the form. Nothing is stored or logged (the image
// never is). Same daily AI cap as "Paste a post" — one shared counter.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.jobsPost)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  if (!roleMayWrite(gate.actor.adminRole, SCREEN_ACCESS.jobsPost)) {
    return NextResponse.json({ error: 'You can view this screen but not post tuitions.' }, { status: 403 })
  }

  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > IMAGE_MAX_BYTES + 64 * 1024) return NextResponse.json({ error: IMAGE_TOO_BIG }, { status: 413 })

  let file: File | null = null
  try {
    const form = await request.formData()
    const v = form.get('image')
    file = v instanceof File ? v : null
  } catch {
    file = null
  }
  if (!file || file.size === 0) return NextResponse.json({ error: 'Choose or paste an image first.' }, { status: 400 })
  if (file.size > IMAGE_MAX_BYTES) return NextResponse.json({ error: IMAGE_TOO_BIG }, { status: 413 })
  if (!imageTypeOk(file.type)) return NextResponse.json({ error: IMAGE_WRONG_TYPE }, { status: 415 })

  const limit = await rateLimit('tuition_ai_fill', gate.actor.id)
  if (!limit.allowed) return NextResponse.json({ error: AI_CAP_REACHED }, { status: 429 })

  const bytes = Buffer.from(await file.arrayBuffer())
  const res = await extractTuitionFromImage(bytes)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status, headers: { 'cache-control': 'no-store' } })
  return NextResponse.json({ fill: res.fill, mobiles: res.mobiles }, { headers: { 'cache-control': 'no-store' } })
}
