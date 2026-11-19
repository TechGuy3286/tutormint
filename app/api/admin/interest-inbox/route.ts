import { NextResponse, after } from 'next/server'

import { checkAdminRole, roleMayWrite, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { parseBody, uuid, z } from '@/lib/validate'
import { INBOX_MEMO_TAG, recordInterestSend } from '@/lib/interestInbox'
import { invalidateMemoTag } from '@/lib/memoCache'
import { refreshWaBadge, undoWaSend } from '@/lib/waUpdates'

// POST /api/admin/interest-inbox (PR-10, owner 19 Nov 2026) — People →
// WhatsApp updates → Parent interest, and the Parent interest panel on a
// parent's member page (one log, so a tutor sent from either place is Sent in
// both). SCREEN_ACCESS.interestInbox; a role outside interestInboxAll (Manager,
// Tuitions staff) may send only the rows assigned to it (its cities).
//
//   { action: 'send', tutorId, from }  the tutor must be sendable now (To send or
//       New activity since sent, within the shared caps). Logged in
//       whatsapp_update_sends (channel 'interest') + audit; the WhatsApp send
//       address comes back for the browser to open.
//   { action: 'undo', id }  the sender (or the Owner), the same Pakistan day.
//
// Nothing is deleted: Undo stamps the row undone. Never logs a phone number.

export const dynamic = 'force-dynamic'

const Body = z.union([
  z.object({ action: z.literal('send'), tutorId: uuid, from: z.enum(['inbox', 'parent_page']).default('inbox') }),
  z.object({ action: z.literal('undo'), id: uuid }),
])

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.interestInbox)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  if (!roleMayWrite(gate.actor.adminRole, SCREEN_ACCESS.interestInbox)) return NextResponse.json({ error: 'Your role can view this list but not send.' }, { status: 403 })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const b = parsed.data

  if (b.action === 'undo') {
    // undoWaSend allows only the sender or the Owner, the same day.
    const res = await undoWaSend(b.id, gate.actor)
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    invalidateMemoTag(INBOX_MEMO_TAG)
    after(() => refreshWaBadge()) // badge + Overview row, after the response
    return NextResponse.json({ success: true })
  }

  const seesAll = roleSatisfies(gate.actor.adminRole, SCREEN_ACCESS.interestInboxAll)
  const res = await recordInterestSend(b.tutorId, gate.actor, { seesAll, from: b.from })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  after(() => refreshWaBadge()) // badge + Overview row, after the response
  return NextResponse.json({ success: true, id: res.id, waHref: res.waHref })
}
