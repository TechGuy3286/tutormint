import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { applicationCheckInLink } from '@/lib/applicationWhatsApp'
import { uuid } from '@/lib/validate'

// GET /api/admin/applications/whatsapp?applicationId=… (owner, 22 Oct 2026)
//
// The WhatsApp button on an Applications row. The same pre-fill method as
// Follow-ups (/api/admin/whatsapp): the English check-in message is built on
// the server from the application's stage (lib/applicationStageCore
// checkInMessage), the tap is logged, and the browser is sent on to
// https://wa.me/92…?text=… — the tutor's number never reaches the page.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.applicantForwards)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const id = uuid.safeParse(new URL(request.url).searchParams.get('applicationId'))
  if (!id.success) return NextResponse.json({ error: 'Something in that request was missing. Reload the page and try again.' }, { status: 400 })

  const wa = await applicationCheckInLink(id.data)
  if (!wa) return NextResponse.json({ error: 'This tutor has no mobile or WhatsApp number on file.' }, { status: 404 })
  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'application.whatsapp_open',
    targetType: 'job',
    targetId: wa.jobId,
    detail: { applicationId: id.data, tutorId: wa.tutorId, stage: wa.stage },
  })
  return NextResponse.redirect(wa.href, { status: 302, headers: { 'Cache-Control': 'private, no-store' } })
}
