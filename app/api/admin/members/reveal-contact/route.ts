import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auditLog'
import { realEmail } from '@/lib/contactMaskCore'
import { formatPkMobile } from '@/lib/phone'
import { whatsappTarget } from '@/lib/tutorWhatsapp'
import { parseBody, z, uuid } from '@/lib/validate'

// POST /api/admin/members/reveal-contact { memberId, field: 'phone' | 'email' | 'whatsapp' }
// (owner, 26 Oct 2026). The member page header shows the phone and email
// masked; "Show" calls this, which writes Audit (who, whose, which field —
// never the value) BEFORE returning the value. The auto-made
// @users.tutormint.org address is never returned.

export const dynamic = 'force-dynamic'

const Body = z.object({ memberId: uuid, field: z.enum(['phone', 'email', 'whatsapp']) })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.memberContactReveal)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const { memberId, field } = parsed.data
  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'This is not working right now.' }, { status: 503 })
  const { data: p } = await admin.from('profiles').select('phone_number, whatsapp, email').eq('id', memberId).maybeSingle()
  if (!p) return NextResponse.json({ error: 'That member was not found.' }, { status: 404 })
  let waNumber: string | null = null
  if (field === 'whatsapp') {
    const { data: tp } = await admin.from('tutor_profiles').select('whatsapp_number').eq('id', memberId).maybeSingle()
    const t = whatsappTarget({ whatsapp: p.whatsapp as string | null, whatsappNumber: (tp?.whatsapp_number as string | null) ?? null, phone: p.phone_number as string | null })
    waNumber = t.msisdn ? formatPkMobile(t.msisdn) : null
  }
  const value =
    field === 'whatsapp'
      ? waNumber
      : field === 'phone'
      ? formatPkMobile(((p.phone_number as string | null) ?? (p.whatsapp as string | null) ?? '') as string) || null
      : realEmail(p.email as string | null)
  if (!value) return NextResponse.json({ error: 'Nothing on file.' }, { status: 404 })
  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'member.contact_reveal',
    targetType: 'profile',
    targetId: memberId,
    detail: { field },
  })
  return NextResponse.json({ success: true, value }, { headers: { 'Cache-Control': 'no-store' } })
}
