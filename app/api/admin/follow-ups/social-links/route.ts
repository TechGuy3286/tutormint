import { NextResponse } from 'next/server'

import { loadSupportWhatsApp } from '@/lib/applicationTemplates'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordFollowUp, undoTutorFollowUp } from '@/lib/followUps'
import { senderRefCode } from '@/lib/staffSignups'
import {
  fillSocialLinks,
  socialLinksAllowed,
  socialLinksBlock,
  socialPagesFrom,
  SOCIAL_LINKS_DEFAULT,
  SOCIAL_LINKS_FOLLOW_UP_SOURCE,
  SOCIAL_LINKS_TEMPLATE_KEY,
} from '@/lib/socialLinksCore'
import { normalisePkMobile } from '@/lib/phone'
import { formatName } from '@/lib/formatName'
import { waSendHref } from '@/lib/waLinkCore'
import { parseBody, z, uuid } from '@/lib/validate'

// POST /api/admin/follow-ups/social-links (owner, 31 Oct 2026) — "Send social
// links" on a paid tutor's member page, beside "Send status image".
//
//   { action: 'record', memberId }  the tutor must have paid the Verification
//       Fee; the message (template social_links) is built here with one line
//       per SOCIAL_* page that is set, each carrying the sender's ref code where
//       the platform allows; a follow-up is recorded; the WhatsApp address comes
//       back for the browser to open.
//   { action: 'undo', id }  the 10-second Undo — the sender only.
//
// Rules: lib/socialLinksCore.

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
  const [{ data: p }, { data: tp }, { data: tpl }] = await Promise.all([
    admin.from('profiles').select('role, full_name, whatsapp, phone_number').eq('id', b.memberId).maybeSingle(),
    admin.from('tutor_profiles').select('verified_fee_paid_at').eq('id', b.memberId).maybeSingle(),
    admin.from('admin_message_templates').select('body').eq('key', SOCIAL_LINKS_TEMPLATE_KEY).maybeSingle(),
  ])
  if (!socialLinksAllowed({ role: p?.role as string | null, feePaidAt: tp?.verified_fee_paid_at as string | null })) {
    return NextResponse.json({ error: 'Social links are sent only to tutors who have paid.' }, { status: 403 })
  }
  const pages = socialPagesFrom(process.env)
  if (pages.length === 0) return NextResponse.json({ error: 'No social page is set yet (SOCIAL_* settings).' }, { status: 400 })
  const msisdn = normalisePkMobile(((p?.whatsapp as string | null) ?? (p?.phone_number as string | null)) ?? null)
  if (!msisdn) return NextResponse.json({ error: 'This tutor has no WhatsApp number.' }, { status: 400 })

  const refCode = await senderRefCode(gate.actor.id)
  const firstName = formatName((p?.full_name as string | null) ?? '').split(' ')[0] ?? ''
  const text = fillSocialLinks(((tpl?.body as string | null) ?? SOCIAL_LINKS_DEFAULT) as string, {
    firstName,
    socialLinks: socialLinksBlock(pages, refCode),
    supportWhatsapp: await loadSupportWhatsApp(admin),
  })
  const res = await recordFollowUp({
    memberId: b.memberId,
    channel: 'whatsapp',
    templateKey: SOCIAL_LINKS_TEMPLATE_KEY,
    source: SOCIAL_LINKS_FOLLOW_UP_SOURCE,
    actor: gate.actor,
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ success: true, id: res.id, waHref: waSendHref(msisdn, text) })
}
