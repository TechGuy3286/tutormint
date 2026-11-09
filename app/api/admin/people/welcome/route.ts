import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseSupervisorMember } from '@/lib/supervisorScope'
import { recordFollowUp, undoTutorFollowUp } from '@/lib/followUps'
import { buildWelcome, refreshWelcomeOnRow } from '@/lib/paidWelcome'
import { WELCOME_SOURCE, WELCOME_TEMPLATE_KEY } from '@/lib/paidWelcomeCore'
import { parseBody, uuid, z } from '@/lib/validate'

// POST /api/admin/people/welcome (owner, 9 Nov 2026) — "Send welcome" on a
// paid tutor's People card.
//
//   { action: 'record', memberId }  the tutor must have paid the Verification
//       Fee. The welcome text (lib/paidWelcomeCore) is built here with the live
//       profile link and the sender's staff ref; a follow-up is recorded
//       (source 'welcome' — Activity tab, Audit) and the WhatsApp address comes
//       back for the browser to open. The card then shows "Welcomed ✓".
//   { action: 'undo', id }  the 10-second Undo — the sender only.
//
// Nothing is deleted: Undo stamps the follow-up undone.

export const dynamic = 'force-dynamic'

const Body = z.union([
  z.object({ action: z.literal('record'), memberId: uuid }),
  z.object({ action: z.literal('undo'), id: uuid, memberId: uuid }),
])

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.paidWelcome)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const b = parsed.data

  if (b.action === 'undo') {
    const res = await undoTutorFollowUp(b.id, gate.actor)
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    await refreshWelcomeOnRow(b.memberId)
    return NextResponse.json({ success: true })
  }

  const scope = await refuseSupervisorMember(gate.actor, b.memberId)
  if (scope) return scope

  const built = await buildWelcome(b.memberId, gate.actor.id)
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: built.status })
  const res = await recordFollowUp({
    memberId: b.memberId,
    channel: 'whatsapp',
    templateKey: WELCOME_TEMPLATE_KEY,
    source: WELCOME_SOURCE,
    actor: gate.actor,
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  await refreshWelcomeOnRow(b.memberId)
  return NextResponse.json({ success: true, id: res.id, waHref: built.waHref })
}
