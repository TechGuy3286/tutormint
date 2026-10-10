import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { saveDocumentRotation } from '@/lib/docRotationServer'
import { parseBody, z, uuid } from '@/lib/validate'

// "Save rotation" in the admin document viewer (owner, 10 Oct 2026). A display
// setting on the document's row — the stored file is never modified. Owner,
// admin and operations (SCREEN_ACCESS.documentRotate); a Partner (view-only) is
// refused by checkAdminRole. Audited with the old and new rotation. Not behind
// the approved-document lock: that lock is for members, not staff settings.

export const dynamic = 'force-dynamic'

const Body = z.object({
  documentId: uuid,
  /** Quarter turns clockwise from the picture as currently shown. */
  delta: z.union([z.literal(90), z.literal(180), z.literal(270)]),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.documentRotate)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const result = await saveDocumentRotation({ actor: gate.actor, documentId: parsed.data.documentId, delta: parsed.data.delta })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, rotation: result.rotation, previous: result.previous })
}
