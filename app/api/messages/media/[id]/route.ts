import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { attachmentPathFor } from '@/lib/messaging'

// Serve a message's photo attachment — ONLY to a participant of its thread.
//
// attachmentPathFor returns the object path only when the caller is a
// participant; anything else (a stranger's id, a message with no photo, a
// non-participant) comes back null and becomes a 404, so a photo is readable
// only inside the conversation it belongs to and never by URL alone. The bytes
// are downloaded with the service role because message-media is private and has
// no participant-wide read policy — the authorisation is the participant check
// above, not a storage grant.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found', { status: 404 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Not found', { status: 404 })

  const path = await attachmentPathFor(user.id, id)
  if (!path) return new NextResponse('Not found', { status: 404 })

  const admin = createAdminClient()
  if (!admin) return new NextResponse('Not found', { status: 404 })

  const { data, error } = await admin.storage.from('message-media').download(path)
  if (error || !data) return new NextResponse('Not found', { status: 404 })

  const bytes = new Uint8Array(await data.arrayBuffer())
  const type = path.endsWith('.png') ? 'image/png' : 'image/jpeg'
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'private, no-store',
      'Content-Disposition': 'inline',
    },
  })
}
