import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { resetAvatarToOriginal, saveAvatarCrop } from '@/lib/avatarCrop'
import { parseBody, z, uuid } from '@/lib/validate'

// "Crop / adjust" for a PROFILE PHOTO in the admin viewer (owner, 11 Oct 2026).
// Same access as rotate: owner / admin / operations (SCREEN_ACCESS
// .documentRotate); a Partner is refused by checkAdminRole; signed out 401.
//   { memberId, crop: { x, y, s } }   save a square copy beside the upload and
//                                     point the profile at it
//   { memberId, reset: true }         "Reset to original"
// The uploaded file is never changed. Audited in lib/avatarCrop.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const fraction = z.number().min(0).max(1)
const Body = z.object({
  memberId: uuid,
  crop: z.object({ x: fraction, y: fraction, s: z.number().min(0.01).max(4) }).optional(),
  reset: z.boolean().optional(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.documentRotate)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const { memberId, crop, reset } = parsed.data
  if (!reset && !crop) return NextResponse.json({ error: 'Move the photo into the circle first.' }, { status: 400 })

  // Owner-only approvals (owner, 15 Oct 2026): every other role views only.
  const notOwner = await refuseUnlessOwnerApproval(gate.actor, reset ? 'reset a cropped profile photo' : 'crop a profile photo', memberId)
  if (notOwner) return notOwner

  const result = reset ? await resetAvatarToOriginal({ actor: gate.actor, memberId }) : await saveAvatarCrop({ actor: gate.actor, memberId, crop: crop! })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, avatarUrl: result.avatarUrl, originalUrl: result.originalUrl })
}
