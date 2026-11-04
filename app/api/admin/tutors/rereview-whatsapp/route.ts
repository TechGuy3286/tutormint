import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadSupportWhatsApp } from '@/lib/applicationTemplates'
import { senderRefCode } from '@/lib/staffSignups'
import { normalisePkMobile } from '@/lib/phone'
import { formatName } from '@/lib/formatName'
import { siteLink, waSendHref } from '@/lib/waLinkCore'
import { finalRejectReason } from '@/lib/rejectReasonsCore'
import { logAdminAction } from '@/lib/auditLog'
import {
  REREVIEW_DEFAULT,
  REREVIEW_LINK_PATH,
  REREVIEW_TEMPLATE_KEY,
  fillRereviewRejected,
  rereviewDocumentName,
} from '@/lib/rereviewTemplateCore'

// GET /api/admin/tutors/rereview-whatsapp?tutorId&item&reason (owner, 4 Nov
// 2026) — "Send on WhatsApp" after a member's replaced profile picture or
// selfie was not approved. Builds the English template `rereview_rejected` on
// the server (the tutor's number never reaches the page) and redirects to
// WhatsApp. Audited, never with the number.

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.tutors)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const url = new URL(request.url)
  const tutorId = url.searchParams.get('tutorId') ?? ''
  const item = url.searchParams.get('item')
  if (!UUID.test(tutorId) || (item !== 'profile_pic' && item !== 'selfie')) {
    return NextResponse.json({ error: 'Something in that request was missing. Reload the page and try again.' }, { status: 400 })
  }
  const reason = finalRejectReason((url.searchParams.get('reason') ?? '').slice(0, 1000))

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'This is not working right now.' }, { status: 503 })
  const [{ data: p }, { data: tpl }] = await Promise.all([
    admin.from('profiles').select('full_name, whatsapp, phone_number').eq('id', tutorId).maybeSingle(),
    admin.from('admin_message_templates').select('body').eq('key', REREVIEW_TEMPLATE_KEY).maybeSingle(),
  ])
  const msisdn = normalisePkMobile(((p?.whatsapp as string | null) ?? (p?.phone_number as string | null)) ?? null)
  if (!msisdn) return NextResponse.json({ error: 'This tutor has no WhatsApp number.' }, { status: 400 })

  const body = ((tpl?.body as string | null) ?? '').trim() || REREVIEW_DEFAULT
  const text = fillRereviewRejected(body, {
    firstName: formatName((p?.full_name as string | null) ?? '').split(' ')[0] ?? '',
    document: rereviewDocumentName(item),
    reason,
    link: siteLink(REREVIEW_LINK_PATH),
    supportWhatsapp: await loadSupportWhatsApp(admin),
  })
  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'tutor.rereview_whatsapp',
    targetType: 'tutor_profile',
    targetId: tutorId,
    detail: { item },
  })
  return NextResponse.redirect(waSendHref(msisdn, text, await senderRefCode(gate.actor.id)), 302)
}
