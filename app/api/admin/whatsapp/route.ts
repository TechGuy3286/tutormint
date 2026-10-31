import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS, type AdminActor } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { adminWhatsAppFor } from '@/lib/adminWhatsApp'
import { senderRefCode } from '@/lib/staffSignups'
import { parseWhatsAppFrom } from '@/lib/adminWhatsAppCore'
import { sendParentMessage } from '@/lib/parentWhatsApp'
import { createAdminClient } from '@/lib/supabase/admin'
import { uuid } from '@/lib/validate'

// /api/admin/whatsapp (owner, 20 Oct 2026; parents 27 Oct 2026)
//
// Every admin WhatsApp button that opens a chat with a member comes here; the
// message is built on the server from the member's own state.
//
//   • A PARENT: the situation message (lib/parentWhatsApp — Team inbox →
//     Templates → Parents), always with a TutorMint link and the sender's ref,
//     recorded as a follow-up with the same Undo, 3-day wait and 3-message
//     rules as tutors. A parent with no situation (a test, staff-linked,
//     paused or banned account) gets an error, never a generic message.
//   • A TUTOR or anyone else: lib/adminWhatsAppCore, as before.
//
//   GET  ?memberId=…&from=…  a link: builds, records and redirects to WhatsApp.
//   POST { memberId, from }  the buttons: returns { href, followUpId } so the
//        page can open WhatsApp and offer the 10-second Undo.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'


const BAD = 'Something in that request was missing. Reload the page and try again.'
const NO_NUMBER = 'This member has no mobile or WhatsApp number on file.'

type Built = { href: string; followUpId: string | null; type: string } | { error: string; status: number }

async function build(memberId: string, actor: AdminActor, from: string | null): Promise<Built> {
  const admin = createAdminClient()
  const { data: p } = admin ? await admin.from('profiles').select('role').eq('id', memberId).maybeSingle() : { data: null }
  const isParent = p?.role === 'parent' || p?.role === 'academy'
  if (isParent) {
    const r = await sendParentMessage(memberId, actor)
    if (r.ok && r.waHref) return { href: r.waHref, followUpId: r.id, type: `parent:${r.reason}` }
    if (r.ok && r.emailed) return { error: 'This parent has no WhatsApp number. The message was sent in the app and by email instead.', status: 409 }
    // Never a generic parent text (owner, 31 Oct 2026): a parent with no
    // situation message (a test, staff-linked, paused or banned account) gets
    // the reason in words, not a fallback message.
    if (!r.ok) return { error: r.error, status: r.status }
    return { error: 'There is no message for this parent right now.', status: 409 }
  }
  const wa = await adminWhatsAppFor(memberId, new Date(), await senderRefCode(actor.id))
  if (!wa.href) return { error: NO_NUMBER, status: 404 }
  await logAdminAction({
    actorId: actor.id,
    actorRole: actor.adminRole,
    actorEmail: actor.email,
    action: 'member.whatsapp_open',
    targetType: 'profile',
    targetId: memberId,
    detail: { messageType: wa.type, from: parseWhatsAppFrom(from) },
  })
  return { href: wa.href, followUpId: null, type: wa.type }
}

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.users, ...SCREEN_ACCESS.unpaidSignups, ...SCREEN_ACCESS.tutors, ...SCREEN_ACCESS.parents)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const params = new URL(request.url).searchParams
  const id = uuid.safeParse(params.get('memberId'))
  if (!id.success) return NextResponse.json({ error: BAD }, { status: 400 })
  const r = await build(id.data, gate.actor, params.get('from'))
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.redirect(r.href, { status: 302, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.users, ...SCREEN_ACCESS.unpaidSignups, ...SCREEN_ACCESS.tutors, ...SCREEN_ACCESS.parents)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const body = (await request.json().catch(() => null)) as { memberId?: unknown; from?: unknown } | null
  const id = uuid.safeParse(body?.memberId)
  if (!id.success) return NextResponse.json({ error: BAD }, { status: 400 })
  const r = await build(id.data, gate.actor, typeof body?.from === 'string' ? body.from : null)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ href: r.href, followUpId: r.followUpId, type: r.type }, { headers: { 'Cache-Control': 'private, no-store' } })
}
