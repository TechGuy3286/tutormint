import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { parseBody, uuid, z } from '@/lib/validate'
import { recordWaSend, refreshWaBadge, undoWaSend } from '@/lib/waUpdates'
import { recordFeaturedSend, undoFeaturedSend } from '@/lib/featuredMatches'

// POST /api/admin/whatsapp-updates (PR-06, owner 18 Nov 2026) — People →
// WhatsApp updates. The Owner, the Project Manager and Backend Support only
// (SCREEN_ACCESS.waUpdates; checkAdminRole refuses everyone else).
//
//   { action: 'send', tutorId }  the tutor must be in today's queue (eligible,
//       opted in, has a WhatsApp number, something to send, under 2 this week).
//       The send is logged (whatsapp_update_sends + audit, staff and time) and
//       the WhatsApp send address comes back for the browser to open.
//   { action: 'undo', id }       the sender (or the Owner), the same day.
//   { action: 'featured_send', itemId } / { action: 'featured_undo', itemId }
//       PR-14: a "Featured — matched tuitions" item (lib/featuredMatches) —
//       the same Send / Undo, logged in featured_match_items + audit, and NOT
//       counted in the per-tutor caps.
//
// Nothing is deleted: Undo stamps the row undone. Never logs a phone number.

export const dynamic = 'force-dynamic'

const Body = z.union([
  z.object({ action: z.literal('send'), tutorId: uuid }),
  z.object({ action: z.literal('undo'), id: uuid }),
  z.object({ action: z.literal('featured_send'), itemId: uuid }),
  z.object({ action: z.literal('featured_undo'), itemId: uuid }),
])

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.waUpdates)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const b = parsed.data

  if (b.action === 'featured_send') {
    const res = await recordFeaturedSend(b.itemId, gate.actor)
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    await refreshWaBadge()
    return NextResponse.json({ success: true, id: b.itemId, waHref: res.waHref })
  }
  if (b.action === 'featured_undo') {
    const res = await undoFeaturedSend(b.itemId, gate.actor)
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    await refreshWaBadge()
    return NextResponse.json({ success: true })
  }

  if (b.action === 'undo') {
    const res = await undoWaSend(b.id, gate.actor)
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    await refreshWaBadge()
    return NextResponse.json({ success: true })
  }

  const res = await recordWaSend(b.tutorId, gate.actor)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  await refreshWaBadge()
  return NextResponse.json({ success: true, id: res.id, waHref: res.waHref })
}
