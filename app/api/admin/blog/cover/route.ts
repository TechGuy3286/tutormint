import { NextResponse } from 'next/server'
import { serverError } from '@/lib/errorResponse'
import { randomUUID } from 'node:crypto'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { publicBlogUrl } from '@/lib/blog'
import { bannedClaims } from '@/lib/brandClaims'
import { completeWithImage, isConfigured } from '@/lib/ai/anthropic'

// Cover-image upload for the blog editor. The file is checked (image, size) and
// stored in the public `blog` bucket under a path we choose; the row only ever
// holds the path, and the alt text is required at publish time (canPublish).
//
// Uploaded through this route rather than straight to storage so an admin's
// browser never needs the storage grant and the file is validated first.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 4 MB, deliberately UNDER the ~4.5 MB Vercel serverless request-body cap: a
// body larger than that is rejected by the platform with a 413 before this
// handler ever runs, so a 5 MB limit here was a promise the route could not
// keep. The editor compresses every cover in the browser first (well under
// this), so a real cover never approaches it; this bound only turns a stray
// oversized upload into a clear JSON error instead of an opaque platform 413.
const MAX_BYTES = 4 * 1024 * 1024

/**
 * THE UPLOAD GUARD (owner, 13 Oct 2026). The covers that said "Pakistan's
 * Largest Tutors Network" were made outside TutorMint and uploaded here with
 * the line already in the picture, so checking our own generator is not enough.
 * The words in an uploaded cover are read (the same image reader the CNIC number
 * uses) and a cover that says "largest", "best", "No.1", "#1" or "most trusted"
 * is refused. A read that cannot be made (no key, a timeout, an unusual format)
 * never blocks an upload — the response says the text was not checked.
 */
async function wordsInImage(file: File, bytes: Uint8Array): Promise<string | null> {
  const mediaType = file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : file.type === 'image/jpeg' ? 'image/jpeg' : null
  if (!mediaType || !isConfigured() || bytes.byteLength > 3.5 * 1024 * 1024) return null
  const res = await completeWithImage({
    system: 'You read the text printed in an image. Reply with the words only.',
    prompt: 'Write out every word of text that appears in this image, exactly as written, on one line. If there is no text at all, reply NONE.',
    image: { mediaType, base64: Buffer.from(bytes).toString('base64') },
    maxTokens: 200,
    timeoutMs: 15_000,
  }).catch(() => null)
  if (!res || !res.ok) return null
  return res.text
}

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.blog)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Choose an image.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That image is larger than ${Math.round(MAX_BYTES / (1024 * 1024))} MB.` },
      { status: 400 },
    )
  }
  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'The cover must be an image.' }, { status: 400 })
  }

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `covers/${randomUUID()}.${ext}`
  const bytes = new Uint8Array(await file.arrayBuffer())

  const words = await wordsInImage(file, bytes)
  const banned = words ? bannedClaims(words) : []
  if (banned.length > 0) {
    return NextResponse.json(
      {
        error: `This cover says “${banned.join('”, “')}”. TutorMint makes no claim it cannot prove — remove the line from the picture and upload it again, or use “Regenerate cover”.`,
      },
      { status: 400 },
    )
  }

  const { error } = await admin.storage.from('blog').upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  })
  if (error) return serverError(error, 'admin/blog/cover')

  return NextResponse.json({ success: true, path, url: publicBlogUrl(path), textChecked: words !== null })
}
