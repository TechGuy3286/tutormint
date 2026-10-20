import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logAdminAction } from '@/lib/auditLog'
import { adminWhatsAppFor } from '@/lib/adminWhatsApp'
import { parseWhatsAppFrom } from '@/lib/adminWhatsAppCore'
import { uuid } from '@/lib/validate'

// GET /api/admin/whatsapp?memberId=…&from=… (owner, 20 Oct 2026)
//
// Every admin WhatsApp button that used to open a BLANK chat points here: the
// message is built from the member's own state (lib/adminWhatsAppCore), the
// tap is logged with its message type, and the browser is sent on to
// https://wa.me/92…?text=…. A GET (a link), so a Partner may open it too.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROLES = [...new Set([...SCREEN_ACCESS.users, ...SCREEN_ACCESS.unpaidSignups, ...SCREEN_ACCESS.tutors, ...SCREEN_ACCESS.parents])]

export async function GET(request: Request) {
  const gate = await checkAdminRole(...ROLES)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const params = new URL(request.url).searchParams
  const id = uuid.safeParse(params.get('memberId'))
  if (!id.success) return NextResponse.json({ error: 'Something in that request was missing. Reload the page and try again.' }, { status: 400 })

  const wa = await adminWhatsAppFor(id.data)
  if (!wa.href) {
    return NextResponse.json({ error: 'This member has no mobile or WhatsApp number on file.' }, { status: 404 })
  }
  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'member.whatsapp_open',
    targetType: 'profile',
    targetId: id.data,
    detail: { messageType: wa.type, from: parseWhatsAppFrom(params.get('from')) },
  })
  return NextResponse.redirect(wa.href, { status: 302, headers: { 'Cache-Control': 'private, no-store' } })
}
