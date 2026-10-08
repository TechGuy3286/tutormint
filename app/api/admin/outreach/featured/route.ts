import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { recordFeaturedSend } from '@/lib/staffOutreach'
import { RELOAD_AND_RETRY } from '@/lib/tutorSubjectCap'
import { parseBody, z } from '@/lib/validate'

// Admin → People → Featured WhatsApp: record a send, then hand back the wa.me
// link (owner, 8 Oct 2026). The send is recorded FIRST, per (tutor, tuition),
// so the same tuitions are never sent twice and a second staff member is
// refused with who sent them. SCREEN_ACCESS.featuredWhatsapp. Audited.

export const runtime = 'nodejs'

const Body = z.object(
  {
    tutorId: z.guid({ message: RELOAD_AND_RETRY }),
    jobIds: z.array(z.guid({ message: RELOAD_AND_RETRY }), { message: RELOAD_AND_RETRY }).min(1, { message: RELOAD_AND_RETRY }).max(20, { message: RELOAD_AND_RETRY }),
  },
  { message: RELOAD_AND_RETRY },
)

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.featuredWhatsapp)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const r = await recordFeaturedSend(parsed.data.tutorId, parsed.data.jobIds, {
    id: gate.actor.id,
    adminRole: gate.actor.adminRole,
    email: gate.actor.email,
  })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, href: r.href, sentAt: r.sentAt })
}
