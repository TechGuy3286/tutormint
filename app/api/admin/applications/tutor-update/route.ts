import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { sendTutorUpdate } from '@/lib/applicationFollowUps'
import { parseBody, z, uuid } from '@/lib/validate'

// POST /api/admin/applications/tutor-update (owner, 22 Oct 2026, Applications v3)
//
// By tutor: one WhatsApp to the tutor listing all their active applications.
// A tutor update is recorded on each — it never counts as the parent follow-up.

export const dynamic = 'force-dynamic'

const Body = z.object({ tutorId: uuid })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.applicantForwards)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const r = await sendTutorUpdate(gate.actor, parsed.data.tutorId)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ success: true, href: r.href, followUpIds: r.followUpIds }, { headers: { 'Cache-Control': 'private, no-store' } })
}
