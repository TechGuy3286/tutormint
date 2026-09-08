import { NextResponse } from 'next/server'

import { checkAdminRole, roleSatisfies, SCREEN_ACCESS } from '@/lib/adminAuth'
import { sendAdminMessage, saveTemplate } from '@/lib/adminMessaging'
import { parseBody, z, uuid } from '@/lib/validate'

// The admin side of the official TutorMint Team channel.
//
//   POST { memberId, body, templateKey? }  — send a message to a member
//   PUT  { key, title, subject, body }      — edit a template (owner/manager)
//
// owner / manager / support may send; only owner/manager may edit the library.

const SendBody = z.object({
  memberId: uuid,
  body: z.string().min(2, 'Write a message.').max(4000),
  templateKey: z.string().max(64).nullish(),
  channel: z.enum(['inapp', 'whatsapp']).optional(),
})

const TemplateBody = z.object({
  key: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.inbox)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, SendBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const result = await sendAdminMessage({
    memberId: body.memberId!,
    body: body.body ?? '',
    templateKey: body.templateKey ?? null,
    channel: body.channel ?? 'inapp',
    actor: { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email },
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  // waHref (WhatsApp channel only) is the link the admin clicks to actually send.
  return NextResponse.json({ success: true, waHref: result.waHref ?? null })
}

export async function PUT(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.inbox)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  // Editing the shared library is owner/manager, not support.
  if (!roleSatisfies(gate.actor.adminRole, ['manager'])) {
    return NextResponse.json({ error: 'Only an owner or manager can edit templates.' }, { status: 403 })
  }

  const parsed = await parseBody(request, TemplateBody)
  if (!parsed.ok) return parsed.response
  const t = parsed.data

  const result = await saveTemplate(
    { key: t.key!, title: t.title!, subject: t.subject!, body: t.body! },
    gate.actor.id,
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ success: true })
}
