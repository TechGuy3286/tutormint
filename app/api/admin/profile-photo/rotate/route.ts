import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { saveAvatarRotation } from '@/lib/avatarRotation'
import { parseBody, z, uuid } from '@/lib/validate'

// "Save rotation" for a PROFILE PHOTO in the admin viewer (owner, 10 Oct 2026).
// Same rules as a document: a saved setting, the uploaded file never changed,
// owner / admin / operations only (SCREEN_ACCESS.documentRotate), a Partner
// refused by checkAdminRole, audited with the old and new rotation.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const Body = z.object({
  memberId: uuid,
  /** Quarter turns clockwise from the picture as currently shown. */
  delta: z.union([z.literal(90), z.literal(180), z.literal(270)]),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.documentRotate)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const result = await saveAvatarRotation({ actor: gate.actor, memberId: parsed.data.memberId, delta: parsed.data.delta })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, rotation: result.rotation, previous: result.previous, avatarUrl: result.avatarUrl })
}
