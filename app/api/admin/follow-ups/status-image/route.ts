import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordFollowUp, undoTutorFollowUp } from '@/lib/followUps'
import { statusImageFacts } from '@/lib/social/statusImage'
import {
  fillStatusMessage,
  STATUS_FOLLOW_UP_SOURCE,
  STATUS_IMAGE_DEFAULT,
  STATUS_IMAGE_TEMPLATE_KEY,
} from '@/lib/social/statusImageCore'
import { normalisePkMobile } from '@/lib/phone'
import { waSendHref } from '@/lib/waLinkCore'
import { parseBody, z, uuid } from '@/lib/validate'

// POST /api/admin/follow-ups/status-image (owner, 26 Oct 2026) — "Send status
// image" on a tutor's admin page and Paid tutors row.
//
//   { action: 'record', memberId }  the tutor must have the Verified badge; the
//       WhatsApp message (template status_image_verified — never a link) is
//       built here, a follow-up is recorded (Activity tab, Audit), and the
//       WhatsApp address comes back for the browser to open.
//   { action: 'undo', id }  the 10-second Undo — the sender only.
//
// The PNG itself is GET /api/admin/social/status-image; the browser downloads it.

export const dynamic = 'force-dynamic'

const Body = z.union([
  z.object({ action: z.literal('record'), memberId: uuid }),
  z.object({ action: z.literal('undo'), id: uuid }),
])

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.statusImage)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const b = parsed.data

  if (b.action === 'undo') {
    const res = await undoTutorFollowUp(b.id, gate.actor)
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    return NextResponse.json({ success: true })
  }

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'This is not working right now.' }, { status: 503 })
  const facts = await statusImageFacts(admin, b.memberId)
  if (!facts.allowed) return NextResponse.json({ error: 'Only verified tutors have a status image.' }, { status: 403 })
  const [{ data: p }, { data: tpl }] = await Promise.all([
    admin.from('profiles').select('whatsapp, phone_number').eq('id', b.memberId).maybeSingle(),
    admin.from('admin_message_templates').select('body').eq('key', STATUS_IMAGE_TEMPLATE_KEY).maybeSingle(),
  ])
  const msisdn = normalisePkMobile(((p?.whatsapp as string | null) ?? (p?.phone_number as string | null)) ?? null)
  if (!msisdn) return NextResponse.json({ error: 'This tutor has no WhatsApp number.' }, { status: 400 })
  // No link, ever: no staff code is added (nothing to add it to).
  const text = fillStatusMessage(((tpl?.body as string | null) ?? STATUS_IMAGE_DEFAULT) as string, facts.firstName)
  const res = await recordFollowUp({
    memberId: b.memberId,
    channel: 'whatsapp',
    templateKey: STATUS_IMAGE_TEMPLATE_KEY,
    source: STATUS_FOLLOW_UP_SOURCE,
    actor: gate.actor,
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ success: true, id: res.id, waHref: waSendHref(msisdn, text) })
}
