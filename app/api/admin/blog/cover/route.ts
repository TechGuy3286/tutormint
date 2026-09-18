import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { publicBlogUrl } from '@/lib/blog'

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

  const { error } = await admin.storage.from('blog').upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ success: true, path, url: publicBlogUrl(path) })
}
