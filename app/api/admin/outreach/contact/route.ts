import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { logContact } from '@/lib/staffOutreach'
import { CONTACT_OUTCOMES } from '@/lib/staffOutreachCore'
import { RELOAD_AND_RETRY } from '@/lib/tutorSubjectCap'
import { parseBody, z } from '@/lib/validate'

// Admin → People → Unpaid signups: record one call/WhatsApp outcome (owner,
// 8 Oct 2026). Owner, admin, Operations and Tuitions staff
// (SCREEN_ACCESS.unpaidSignups); every other role gets 403. Audited.

export const runtime = 'nodejs'

const Body = z.object(
  {
    tutorId: z.guid({ message: RELOAD_AND_RETRY }),
    outcome: z.enum(CONTACT_OUTCOMES, { message: 'Choose what happened on the call.' }),
    note: z.string({ message: RELOAD_AND_RETRY }).max(1000, { message: 'Keep the note under 1,000 characters.' }).optional(),
  },
  { message: RELOAD_AND_RETRY },
)

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.unpaidSignups)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const r = await logContact(parsed.data.tutorId, parsed.data.outcome, parsed.data.note ?? null, {
    id: gate.actor.id,
    adminRole: gate.actor.adminRole,
    email: gate.actor.email,
  })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
