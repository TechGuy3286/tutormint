import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { undoTutorFollowUp } from '@/lib/followUps'
import { sendParentMessage } from '@/lib/parentWhatsApp'
import { parseBody, z, uuid } from '@/lib/validate'

// POST /api/admin/follow-ups/parent (owner, 26 Oct 2026) — Follow-ups → Parents.
//
//   { action: 'record', memberId }  the parent's situation is worked out again;
//       its template (Team inbox → Templates → Parents) is filled; a follow-up
//       is recorded with the reason and the progress snapshot. With a WhatsApp
//       number, the WhatsApp address comes back for the browser; with only an
//       email, the message goes as an official in-app message + email.
//       "Tutors applied" (27 Oct 2026) sends the tutors' profile links — it is
//       still "waiting on us" on the board and stays out of the badge.
//   { action: 'undo', id }  the 10-second Undo — the sender only.
//
// The message itself is built by lib/parentWhatsApp (one builder for every
// parent WhatsApp button).

export const dynamic = 'force-dynamic'

const Body = z.union([
  z.object({ action: z.literal('record'), memberId: uuid }),
  z.object({ action: z.literal('undo'), id: uuid }),
])

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.signups)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const b = parsed.data

  if (b.action === 'undo') {
    const res = await undoTutorFollowUp(b.id, gate.actor)
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    return NextResponse.json({ success: true })
  }

  const res = await sendParentMessage(b.memberId, gate.actor)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ success: true, id: res.id, waHref: res.waHref, emailed: res.emailed })
}
