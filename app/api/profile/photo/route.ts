import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { storeMemberPhoto } from '@/lib/avatarCrop'
import { validCrop } from '@/lib/photoCropCore'
import { decidePhotoUpload } from '@/lib/docLocks'
import { LOCKED_MESSAGE_EN, LOCKED_MESSAGE_UR } from '@/lib/docLockCore'

// A member's new PROFILE PHOTO (owner, 11 Oct 2026): the photo as chosen and the
// square they framed in the crop step, stored as two new files. Answers with the
// square's address; the screen then saves it as the profile photo the way it
// always did, so the photo-review rules are unchanged. Signed out: 401.
// The browser shrinks both pictures first, so they fit under the request limit.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_ORIGINAL = 4 * 1024 * 1024
const MAX_CROP = 1024 * 1024

const refuse = (status: number, error: string, errorUr?: string) => NextResponse.json({ error, errorUr }, { status })

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return refuse(401, 'Please sign in first, then try again.', 'پہلے سائن اِن کریں، پھر دوبارہ کوشش کریں۔')

  // An APPROVED tutor photo is locked (owner, 17 Oct 2026): nothing new is
  // stored unless the Owner unlocked it. The database refuses the save too
  // (migration 186), so this is the first of two checks, not the only one.
  const lock = await decidePhotoUpload(user.id)
  if (!lock.allow) return NextResponse.json({ error: LOCKED_MESSAGE_EN, errorUr: LOCKED_MESSAGE_UR, locked: true }, { status: lock.status })

  const form = await request.formData().catch(() => null)
  const original = form?.get('original')
  const crop = form?.get('crop')
  if (!(original instanceof File) || !(crop instanceof File)) return refuse(400, 'Choose a photo first.', 'پہلے تصویر چنیں۔')
  if (!original.type.startsWith('image/') || !crop.type.startsWith('image/')) return refuse(400, 'Choose a photo (JPG or PNG).', 'تصویر چنیں (JPG یا PNG)۔')
  if (original.size > MAX_ORIGINAL || crop.size > MAX_CROP) return refuse(413, 'That photo is too large. Please choose a smaller one.', 'یہ تصویر بہت بڑی ہے۔ چھوٹی تصویر چنیں۔')

  const num = (k: string) => Number(form?.get(k))
  const rect = { x: num('x'), y: num('y'), s: num('s') }
  const result = await storeMemberPhoto({
    userId: user.id,
    original: Buffer.from(await original.arrayBuffer()),
    crop: Buffer.from(await crop.arrayBuffer()),
    rect: validCrop(rect) ? rect : null,
  })
  if (!result.ok) return refuse(result.status, result.error, result.errorUr)
  return NextResponse.json({ success: true, url: result.url, originalUrl: result.originalUrl })
}
