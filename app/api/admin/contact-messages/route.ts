import { NextResponse } from 'next/server'

import { checkAdminRole, roleMayWrite, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { parseBody, z } from '@/lib/validate'
import { showContact } from '@/lib/contactFormCore'

// POST /api/admin/contact-messages — the Team inbox's Contact form list (PR-20).
//   { action: 'show', id }  the sender's mobile / email in full. The audit row
//                           (contact_message.reveal) is written BEFORE the value
//                           is returned; the value itself is never logged.
//   { action: 'done' | 'reopen', id }  mark handled / not handled.
// Same access as the Team inbox.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({ action: z.enum(['show', 'done', 'reopen']), id: z.guid() })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.inbox)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const { action, id } = parsed.data
  if (action !== 'show' && !roleMayWrite(gate.actor.adminRole, SCREEN_ACCESS.inbox)) {
    return NextResponse.json({ error: 'You can view this screen but not change it.' }, { status: 403 })
  }
  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Not available just now.' }, { status: 503 })
  const { data: row } = await admin.from('contact_messages').select('id, contact, contact_kind, status').eq('id', id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'That message was not found.' }, { status: 404 })

  const audit = (a: string, detail: Record<string, unknown> = {}) =>
    logAdminAction({ actorId: gate.actor.id, actorRole: gate.actor.adminRole, actorEmail: gate.actor.email, action: a, targetType: 'contact_message', targetId: id, detail })

  if (action === 'show') {
    await audit('contact_message.reveal', { field: row.contact_kind })
    return NextResponse.json({ contact: showContact(row.contact as string, row.contact_kind as 'mobile' | 'email') }, { headers: { 'cache-control': 'no-store' } })
  }
  const done = action === 'done'
  const { error } = await admin
    .from('contact_messages')
    .update(done ? { status: 'done', done_at: new Date().toISOString(), done_by: gate.actor.id } : { status: 'new', done_at: null, done_by: null })
    .eq('id', id)
  if (error) return NextResponse.json({ error: 'That did not save. Try again.' }, { status: 500 })
  await audit(done ? 'contact_message.done' : 'contact_message.reopen')
  return NextResponse.json({ ok: true })
}
