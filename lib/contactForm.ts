import 'server-only'

// lib/contactForm.ts — the server half of lib/contactFormCore (owner, 24 Nov
// 2026 — PR-20 Part A). Stores a /contact message for the Team inbox and
// emails it to the support mailbox. NOTHING from the form is logged: a failure
// logs its reason only, the activity row (signed-in members) carries no text,
// and the email log records the support address and a fixed subject.

import { createAdminClient } from '@/lib/supabase/admin'
import { sendOne } from '@/lib/email/send'
import { getSupportContact } from '@/lib/support'
import { absoluteUrl } from '@/lib/siteUrl'
import { logActivity } from '@/lib/activityLog'
import { pageAll } from '@/lib/pageAll'
import { contactEmail, maskContact, type ContactParsed } from '@/lib/contactFormCore'

type Message = Extract<ContactParsed, { spam: false }>

export const CONTACT_INBOX_PATH = '/admin/inbox/contact'

/** Store the message, then email it to support. Ok when it is stored. */
export async function submitContactMessage(m: Message, memberId: string | null): Promise<{ ok: boolean }> {
  const admin = createAdminClient()
  if (!admin) return { ok: false }
  const { data, error } = await admin
    .from('contact_messages')
    .insert({ name: m.name, contact: m.contact, contact_kind: m.kind, message: m.message, member_id: memberId })
    .select('id')
    .single()
  if (error || !data) {
    console.error('[contact] could not store a message:', (error?.message ?? 'no row').slice(0, 120))
    return { ok: false }
  }
  if (memberId) await logActivity({ userId: memberId, event: 'contact_message_sent', targetType: 'contact_message', targetId: data.id as string, meta: { kind: m.kind } })

  try {
    const support = await getSupportContact()
    if (support.email) {
      const mail = contactEmail({ ...m, inboxUrl: absoluteUrl(CONTACT_INBOX_PATH) })
      const r = await sendOne({ to: support.email, subject: mail.subject, text: mail.text, template: 'contact_form' })
      if (r.ok) await admin.from('contact_messages').update({ emailed: true }).eq('id', data.id)
    }
  } catch (e) {
    console.warn('[contact] email to support failed:', (e instanceof Error ? e.message : String(e)).slice(0, 120))
  }
  return { ok: true }
}

export type InboxContactMessage = {
  id: string
  createdAt: string
  name: string
  maskedContact: string
  kind: 'mobile' | 'email'
  message: string
  status: 'new' | 'done'
  doneAt: string | null
  memberId: string | null
}

/** Every message, newest first — the contact shown masked only. */
export async function loadContactMessages(): Promise<InboxContactMessage[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const rows = (await pageAll((from, to) =>
    admin
      .from('contact_messages')
      .select('id, created_at, name, contact, contact_kind, message, status, done_at, member_id')
      .order('created_at', { ascending: false })
      .range(from, to),
  )) as { id: string; created_at: string; name: string; contact: string; contact_kind: 'mobile' | 'email'; message: string; status: 'new' | 'done'; done_at: string | null; member_id: string | null }[]
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    name: r.name,
    maskedContact: maskContact(r.contact, r.contact_kind),
    kind: r.contact_kind,
    message: r.message,
    status: r.status,
    doneAt: r.done_at,
    memberId: r.member_id,
  }))
}

/** How many messages are still new (the inbox link's count). */
export async function newContactCount(): Promise<number> {
  const admin = createAdminClient()
  if (!admin) return 0
  const { count } = await admin.from('contact_messages').select('id', { count: 'exact', head: true }).eq('status', 'new')
  return count ?? 0
}
