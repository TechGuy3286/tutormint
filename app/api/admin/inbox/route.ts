import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS, roleMayWrite } from '@/lib/adminAuth'
import { sendAdminMessage, saveTemplate, loadTemplates } from '@/lib/adminMessaging'
import { parseBody, z, uuid } from '@/lib/validate'
import { logAdminAction } from '@/lib/auditLog'
import { templateSaveCheck, templateDefault } from '@/lib/templateRules'
import { recordEditHistory } from '@/lib/templateReview'

// The admin side of the official TutorMint Team channel.
//
//   POST { memberId, body, templateKey? }  — send a message to a member
//   PUT  { key, title, subject, body }      — edit a template (owner/manager)
//   PUT  { key, reset: true }                — back to the built-in default
//
// owner / manager / support may send; only owner/manager may edit the library.

const SendBody = z.object({
  memberId: uuid,
  body: z.string().min(2, 'Write a message.').max(4000),
  templateKey: z.string().max(64).nullish(),
  channel: z.enum(['inapp', 'whatsapp']).optional(),
})

const TemplateBody = z.union([
  z.object({
    key: z.string().min(1).max(64),
    title: z.string().min(1).max(200),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(4000),
  }),
  // "Reset to default" (Applications templates and the forward message).
  z.object({ key: z.string().min(1).max(64), reset: z.literal(true) }),
])

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
  if (!roleMayWrite(gate.actor.adminRole, ['admin'])) {
    return NextResponse.json({ error: 'Only an owner or manager can edit templates.' }, { status: 403 })
  }

  const parsed = await parseBody(request, TemplateBody)
  if (!parsed.ok) return parsed.response
  const t = parsed.data
  const current = (await loadTemplates()).find((x) => x.key === t.key)
  if (!current) return NextResponse.json({ error: 'That template was not found. Reload the page.' }, { status: 404 })

  let next = current
  if ('reset' in t) {
    const def = templateDefault(t.key)
    if (def === null) return NextResponse.json({ error: 'This template has no built-in default.' }, { status: 400 })
    next = { ...current, body: def }
  } else {
    next = { key: t.key, title: t.title, subject: t.subject, body: t.body }
  }
  // Unknown placeholders are BLOCKED; a price or superlative is a warning.
  const check = templateSaveCheck(next.key, next.body)
  if (!check.ok) return NextResponse.json({ error: check.error, unknown: check.unknown }, { status: 400 })

  // The wording it replaces stays in the template's history, with Restore (owner, 28 Oct 2026).
  if (next.body !== current.body) await recordEditHistory(gate.actor, current.key, { subject: current.subject ?? null, body: current.body })
  const result = await saveTemplate(next, gate.actor.id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  // Every edit is logged with who and when (Audit; the row also carries
  // updated_by / updated_at). The body is template wording, never member data.
  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'reset' in t ? 'template.reset' : 'template.edit',
    targetType: 'admin_message_template',
    targetId: next.key,
    detail: { key: next.key, titleChanged: next.title !== current.title, bodyChanged: next.body !== current.body, length: next.body.length, warnings: check.warnings.length },
  })
  return NextResponse.json({ success: true, body: next.body, warnings: check.warnings })
}
