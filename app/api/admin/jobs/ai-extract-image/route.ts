import { NextResponse } from 'next/server'

import { checkAdminRole, roleMayWrite, SCREEN_ACCESS, type AdminActor } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { rateLimit } from '@/lib/rateLimit'
import { extractTuitionFromImage } from '@/lib/imageRead'
import { AI_CAP_REACHED, AI_UNAVAILABLE, safeReason } from '@/lib/aiTuitionExtractCore'
import { IMAGE_MAX_BYTES, IMAGE_TOO_BIG, IMAGE_WRONG_TYPE, imageTypeOk } from '@/lib/imageMaskCore'

// POST /api/admin/jobs/ai-extract-image (multipart, field "image") — "Read
// from image" on staff Post a tuition (owner, 24 Nov 2026 — PR-20 Part C).
// The image is read in memory: plain OCR finds the phone numbers and they are
// blacked out BEFORE the AI sees it (lib/imageRead); the masked image is
// checked again and the AI is not called if a number is still readable. The
// numbers found come back for the form. Nothing is stored or logged (the image
// never is). Same daily AI cap as "Paste a post" — one shared counter.
//
// PR-21: every answer is JSON with a plain message (too large / photo type /
// took too long / AI busy / couldn't read safely), never a platform timeout;
// a failure's technical reason (never content) goes to the Owner's Audit log
// as `tuition.ai_fill_failed`. 120 s: OCR has 70, the AI 35 (lib/imageRead).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const NO_STORE = { 'cache-control': 'no-store' }

async function auditFailure(actor: AdminActor, status: number, reason: string) {
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'tuition.ai_fill_failed',
    targetType: 'ai_fill',
    targetId: actor.id,
    detail: { source: 'image', status, reason: safeReason(reason) },
  }).catch(() => undefined)
}

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.jobsPost)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  if (!roleMayWrite(gate.actor.adminRole, SCREEN_ACCESS.jobsPost)) {
    return NextResponse.json({ error: 'You can view this screen but not post tuitions.' }, { status: 403 })
  }
  const actor = gate.actor
  const refuse = async (status: number, error: string, reason: string) => {
    await auditFailure(actor, status, reason)
    return NextResponse.json({ error }, { status, headers: NO_STORE })
  }

  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > IMAGE_MAX_BYTES + 64 * 1024) return refuse(413, IMAGE_TOO_BIG, `too_large_declared_${Math.round(declared / 1024)}kb`)

  let file: File | null = null
  try {
    const form = await request.formData()
    const v = form.get('image')
    file = v instanceof File ? v : null
  } catch {
    file = null
  }
  if (!file || file.size === 0) return NextResponse.json({ error: 'Choose or paste an image first.' }, { status: 400 })
  if (file.size > IMAGE_MAX_BYTES) return refuse(413, IMAGE_TOO_BIG, `too_large_${Math.round(file.size / 1024)}kb`)
  if (!imageTypeOk(file.type)) return refuse(415, IMAGE_WRONG_TYPE, `type_${String(file.type || 'none').replace(/[^a-z0-9/.+-]/gi, '').slice(0, 40)}`)

  const limit = await rateLimit('tuition_ai_fill', gate.actor.id)
  if (!limit.allowed) return NextResponse.json({ error: AI_CAP_REACHED }, { status: 429 })

  try {
    const bytes = Buffer.from(await file.arrayBuffer())
    const res = await extractTuitionFromImage(bytes)
    if (!res.ok) return refuse(res.status, res.error, res.reason)
    return NextResponse.json({ fill: res.fill, mobiles: res.mobiles }, { headers: NO_STORE })
  } catch (e) {
    const reason = `unexpected: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`
    console.warn(`[ai-image] ${safeReason(reason)}`)
    return refuse(503, AI_UNAVAILABLE, reason)
  }
}
