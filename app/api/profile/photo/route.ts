import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { storeMemberPhoto } from '@/lib/avatarCrop'
import { validCrop } from '@/lib/photoCropCore'
import { loadLockFacts } from '@/lib/docLocks'
import { replaceDecision } from '@/lib/memberLocksCore'
import { logActivity } from '@/lib/activityLog'

// A member's new PROFILE PHOTO (owner, 11 Oct 2026): the photo as chosen and the
// square they framed in the crop step, stored as two new files. Answers with the
// square's address; the screen then saves it as the profile photo the way it
// always did. Signed out: 401.
//
// Never refused (owner, 4 Nov 2026 — superseding the 17 Oct photo lock). When an
// APPROVED photo is on record, the database keeps it public and holds the new
// one in profiles.avatar_pending_url for the Owner (migration 222); the Verified
// badge stays. The browser shrinks both pictures first, so they fit under the
// request limit.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_ORIGINAL = 4 * 1024 * 1024
const MAX_CROP = 1024 * 1024

const refuse = (status: number, error: string) => NextResponse.json({ error }, { status })

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return refuse(401, 'Please sign in first, then try again.')

  const form = await request.formData().catch(() => null)
  const original = form?.get('original')
  const crop = form?.get('crop')
  if (!(original instanceof File) || !(crop instanceof File)) return refuse(400, 'Choose a photo first.')
  if (!original.type.startsWith('image/') || !crop.type.startsWith('image/')) return refuse(400, 'Choose a photo (JPG or PNG).')
  if (original.size > MAX_ORIGINAL || crop.size > MAX_CROP) return refuse(413, 'That photo is too large. Please choose a smaller one.')

  const facts = await loadLockFacts(user.id)
  const review = facts ? replaceDecision({ approved: facts.photo.approved, onRecord: facts.photo.onRecord }) === 'review' : false

  const num = (k: string) => Number(form?.get(k))
  const rect = { x: num('x'), y: num('y'), s: num('s') }
  const result = await storeMemberPhoto({
    userId: user.id,
    original: Buffer.from(await original.arrayBuffer()),
    crop: Buffer.from(await crop.arrayBuffer()),
    rect: validCrop(rect) ? rect : null,
    keepRecord: review,
  })
  if (!result.ok) return refuse(result.status, result.error)

  // On the Activity tab (owner, 4 Nov 2026).
  await logActivity({
    userId: user.id,
    event: 'document_uploaded',
    targetType: 'profile',
    targetId: user.id,
    meta: { kind: 'photo', ...(review ? { review: true } : {}) },
  })
  return NextResponse.json({ success: true, url: result.url, originalUrl: result.originalUrl, ...(review ? { review: true } : {}) })
}
