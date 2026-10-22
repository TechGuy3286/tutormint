import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { sendStageFollowUp } from '@/lib/applicationFollowUps'
import { parseBody, z, uuid } from '@/lib/validate'

// POST /api/admin/applications/follow-up (owner, 22 Oct 2026, Applications v3)
//
// A row's WhatsApp button. Records the follow-up (stage, recipient TYPE,
// message key, staff, time — never a number) and returns the wa.me link with
// the stage's message pre-filled, plus the record's id for Undo.

export const dynamic = 'force-dynamic'

const Body = z.object({ applicationId: uuid })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.applicantForwards)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const r = await sendStageFollowUp(gate.actor, parsed.data.applicationId)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ success: true, href: r.href, followUpIds: r.followUpIds }, { headers: { 'Cache-Control': 'private, no-store' } })
}
