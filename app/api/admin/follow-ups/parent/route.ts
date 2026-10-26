import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordFollowUp, undoTutorFollowUp } from '@/lib/followUps'
import { sendAdminMessage } from '@/lib/adminMessaging'
import { parentForSend } from '@/lib/parentFollowUps'
import { fillParentFollowUp, PARENT_DEFAULTS, PARENT_PLACEHOLDERS } from '@/lib/parentFollowUpCore'
import { unknownPlaceholders } from '@/lib/applicationTemplatesCore'
import { loadSupportWhatsApp } from '@/lib/applicationTemplates'
import { senderRefCode } from '@/lib/staffSignups'
import { finishWaText, siteLink, waSendHref } from '@/lib/waLinkCore'
import { formatName } from '@/lib/formatName'
import { parseBody, z, uuid } from '@/lib/validate'

// POST /api/admin/follow-ups/parent (owner, 26 Oct 2026) — Follow-ups → Parents.
//
//   { action: 'record', memberId }  the parent's situation is worked out again
//       here; its template (Team inbox → Templates → Parents) is filled; a
//       follow-up is recorded with the reason and the progress snapshot. With a
//       WhatsApp number, the WhatsApp address comes back for the browser; with
//       only an email, the message goes as an official in-app message + email.
//       "Waiting on us" (tutors to forward) is refused — nothing to send.
//   { action: 'undo', id }  the 10-second Undo — the sender only.

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

  const target = await parentForSend(b.memberId)
  if (!target) return NextResponse.json({ error: 'This parent has nothing to follow up right now.' }, { status: 404 })
  const { row } = target
  if (!row.templateKey) return NextResponse.json({ error: 'This parent is waiting on us — forward the tutors in Applications.' }, { status: 400 })
  if (!target.phone && !target.email) return NextResponse.json({ error: 'This parent has no WhatsApp number or email.' }, { status: 400 })

  const admin = createAdminClient()
  const [{ data: tpl }, support, refCode] = await Promise.all([
    admin!.from('admin_message_templates').select('body').eq('key', row.templateKey).maybeSingle(),
    loadSupportWhatsApp(admin),
    senderRefCode(gate.actor.id),
  ])
  // A stored body that is empty or has an unknown placeholder is never sent — the default is.
  const stored = ((tpl?.body as string | null) ?? '').trim()
  const body = stored && unknownPlaceholders(stored, PARENT_PLACEHOLDERS).length === 0 ? stored : PARENT_DEFAULTS[row.templateKey]
  const hire = target.facts.tuitions.find((t) => t.id === row.tuition?.id)
  const text = fillParentFollowUp(body, {
    firstName: formatName(row.name).split(' ')[0] ?? '',
    tuitionTitle: row.tuition?.title ?? null,
    tuitionLink: row.tuition?.path ? siteLink(row.tuition.path) : null,
    postLink: siteLink('/parent/dashboard/post-job'),
    tutorName: hire?.hiredTutorName ?? null,
    supportWhatsapp: support,
  })

  let waHref: string | null = null
  if (target.phone) {
    waHref = waSendHref(target.phone, finishWaText(text, refCode), refCode)
  } else {
    const sent = await sendAdminMessage({ memberId: b.memberId, body: text, templateKey: row.templateKey, channel: 'inapp', actor: gate.actor })
    if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: sent.status })
  }
  const res = await recordFollowUp({
    memberId: b.memberId,
    channel: target.phone ? 'whatsapp' : 'email',
    templateKey: row.templateKey,
    source: 'parents',
    reason: row.reason,
    progress: row.progress,
    actor: gate.actor,
  })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ success: true, id: res.id, waHref, emailed: !target.phone })
}
