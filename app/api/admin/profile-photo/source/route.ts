import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { loadCropSource } from '@/lib/avatarCrop'
import { uuid } from '@/lib/validate'

// The picture the admin crop frame works on: the member's UPLOADED profile photo,
// the right way up and turned by the saved rotation (so a crop is always cut from
// the original, never from an earlier crop). It is also the full-size view of a
// profile photo on the review cards, so it opens to every staff role that
// reviews documents (owner, 15 Nov 2026 — SCREEN_ACCESS.documentView: the
// Owner, the Project Managers, Backend Support, Admin, Manager, Operations).
// Staff-only, private, never cached; never a public address.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.documentView)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const id = uuid.safeParse(new URL(request.url).searchParams.get('memberId'))
  if (!id.success) return NextResponse.json({ error: 'Something in that request was missing. Reload the page and try again.' }, { status: 400 })
  const result = await loadCropSource(id.data)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return new NextResponse(new Uint8Array(result.image), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' } })
}
