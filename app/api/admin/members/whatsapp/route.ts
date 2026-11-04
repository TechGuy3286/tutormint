import { NextResponse } from 'next/server'

import { checkAdminRole, roleMayWrite, SCREEN_ACCESS } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { refuseOwnerTarget } from '@/lib/ownerGuard'
import { logAdminAction } from '@/lib/auditLog'
import { logActivity } from '@/lib/activityLog'
import { recordFieldChanges } from '@/lib/fieldHistory'
import { doNotUseRefusal } from '@/lib/contactWithdraw'
import { maskWhatsapp, whatsappEditDecision } from '@/lib/whatsappEditCore'
import { parseBody, z, uuid } from '@/lib/validate'

// POST /api/admin/members/whatsapp { memberId, whatsapp, reason } (owner, 4 Nov
// 2026). Staff set or change a tutor's or parent's WhatsApp number from the
// member page's Edit tab (lib/whatsappEditCore). Stored normalised on
// profiles.whatsapp; the sign-in mobile (phone_number) is never touched.
// Refused when the number is on the Do not use list or On hold. Every change
// writes the change history (field 'whatsapp'), Audit (member.whatsapp_edit)
// and the member's timeline — the number masked in all three. logAdminAction
// (target 'profile') rebuilds the tutor's cached public profile.

export const dynamic = 'force-dynamic'

const Body = z.object({ memberId: uuid, whatsapp: z.string().max(40), reason: z.string().max(500) })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.memberWhatsappEdit)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  if (!roleMayWrite(gate.actor.adminRole, SCREEN_ACCESS.memberWhatsappEdit)) {
    return NextResponse.json({ error: 'View only. Your account cannot change this.' }, { status: 403 })
  }
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const { memberId, whatsapp, reason } = parsed.data

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'This is not working right now.' }, { status: 503 })

  const ownerRefusal = await refuseOwnerTarget(gate.actor, memberId, "change the Owner account's WhatsApp number")
  if (ownerRefusal) return ownerRefusal

  const { data: p } = await admin.from('profiles').select('id, role, whatsapp').eq('id', memberId).maybeSingle()
  if (!p) return NextResponse.json({ error: 'That member was not found.' }, { status: 404 })

  const decision = whatsappEditDecision({ targetRole: p.role as string, raw: whatsapp, reason, current: p.whatsapp as string | null })
  if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: decision.status })
  if (decision.unchanged) return NextResponse.json({ ok: true, unchanged: true, masked: maskWhatsapp(decision.msisdn) })

  const listed = await doNotUseRefusal([decision.msisdn])
  if (listed) return NextResponse.json({ error: listed }, { status: 400 })

  const { error } = await admin.from('profiles').update({ whatsapp: decision.msisdn }).eq('id', memberId)
  if (error) return NextResponse.json({ error: 'That did not save. Please try again.' }, { status: 500 })

  const from = maskWhatsapp(p.whatsapp as string | null)
  const to = maskWhatsapp(decision.msisdn)
  await recordFieldChanges([
    {
      tutorId: memberId,
      field: 'whatsapp',
      oldValue: from,
      newValue: to,
      changedBy: gate.actor.id,
      changedByRole: 'staff',
      changedByEmail: gate.actor.email,
      reason: reason.trim(),
    },
  ])
  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email,
    action: 'member.whatsapp_edit',
    targetType: 'profile',
    targetId: memberId,
    detail: { from, to, reason: reason.trim() },
  })
  await logActivity({ userId: memberId, event: 'profile_updated', targetType: 'profile', targetId: memberId, meta: { field: 'whatsapp', by: 'staff' } })

  return NextResponse.json({ ok: true, masked: to })
}
