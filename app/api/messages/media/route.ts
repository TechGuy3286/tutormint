import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { createClient } from '@/lib/supabase/server'
import { getEntitlements } from '@/lib/entitlements'
import { buildGate } from '@/lib/gate'
import { rateLimit, tooManyRequests } from '@/lib/rateLimit'
import { isAllowedAttachment, mayAttachPhoto, ATTACHMENT_MAX_BYTES } from '@/lib/messagingRules'

// Upload a photo attachment to the private `message-media` bucket.
//
// GATED BY CONTACT RIGHTS — the same rule as seeing the other party's contact
// details (mayAttachPhoto reads ent.canViewContact), no new entitlement. A
// member who cannot see contact cannot upload; they get the gate.
//
// The image is re-encoded through sharp, which strips EXIF (a photo's embedded
// GPS/location is not something to forward into a conversation) and gives us the
// real dimensions rather than trusting the client. The object is owned by the
// uploader (path `<uid>/...`); sendMessage re-checks that prefix before it will
// attach the photo to a message, and re-checks the gate.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  const limit = await rateLimit('message', user.id)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'photos')

  const ent = await getEntitlements(user.id)
  if (!mayAttachPhoto(ent)) {
    return NextResponse.json(
      { error: 'Upgrade to send photos.', gate: await buildGate('tutor_message', ent) },
      { status: 403 },
    )
  }

  let file: File | null = null
  try {
    const form = await request.formData()
    const f = form.get('file')
    if (f instanceof File) file = f
  } catch {
    return NextResponse.json({ error: 'No photo received.' }, { status: 400 })
  }
  if (!file || file.size === 0) return NextResponse.json({ error: 'No photo received.' }, { status: 400 })

  if (!isAllowedAttachment(file.type, file.size)) {
    return NextResponse.json(
      { error: `Send a JPG or PNG under ${ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB.` },
      { status: 400 },
    )
  }

  const input = new Uint8Array(await file.arrayBuffer())
  const isPng = file.type === 'image/png'
  let out: Buffer
  let width = 0
  let height = 0
  try {
    const pipeline = sharp(input).rotate() // normalise orientation, drop EXIF
    const meta = await pipeline.metadata()
    width = meta.width ?? 0
    height = meta.height ?? 0
    out = await (isPng ? pipeline.png() : pipeline.jpeg({ quality: 82 })).toBuffer()
  } catch {
    return NextResponse.json({ error: 'That photo could not be read.' }, { status: 400 })
  }

  const ext = isPng ? 'png' : 'jpg'
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from('message-media')
    .upload(path, out, { contentType: file.type, upsert: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ path, w: width, h: height, bytes: out.byteLength })
}
