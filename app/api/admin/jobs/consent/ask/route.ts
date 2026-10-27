import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { senderRefCode } from '@/lib/staffSignups'
import { consentAskLink } from '@/lib/tuitionConsent'
import { uuid } from '@/lib/validate'
import { CONSENT_UI_ENABLED } from '@/lib/tuitionConsentCore'

// GET /api/admin/jobs/consent/ask?jobId=… (owner, 27 Oct 2026)
//
// "Ask parent" on a "Consent not recorded" chip. The message is the editable
// consent_ask template (Team inbox → Templates → Consent), built on the server;
// the parent's number never reaches the page. The tap is in Audit
// (job.consent_ask); the browser is sent on to WhatsApp.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.tuitionConsent)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  // The consent_ask template is inactive (owner, 27 Oct 2026; migration 210).
  if (!CONSENT_UI_ENABLED) return NextResponse.json({ error: 'Asking parents for consent is switched off.' }, { status: 410 })
  const id = uuid.safeParse(new URL(request.url).searchParams.get('jobId'))
  if (!id.success) return NextResponse.json({ error: 'Something in that request was missing. Reload the page and try again.' }, { status: 400 })

  const wa = await consentAskLink(id.data, await senderRefCode(gate.actor.id))
  if (!wa) return NextResponse.json({ error: 'This tuition has no parent number on file. Add it first.' }, { status: 404 })
  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'job.consent_ask',
    targetType: 'job',
    targetId: id.data,
    detail: { channel: 'whatsapp' },
  })
  return NextResponse.redirect(wa.href, { status: 302, headers: { 'Cache-Control': 'private, no-store' } })
}
