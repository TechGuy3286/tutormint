import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { recordForward } from '@/lib/applicantForwards'
import { parseBody, z, uuid } from '@/lib/validate'

// "Mark as forwarded" on Marketplace → Applicants to forward (owner, 10 Oct
// 2026): staff told a tuition's parent which paid tutors are interested. Records
// when, who, the channel and exactly which tutors were included. Owner, admin,
// operations and tuitions staff (SCREEN_ACCESS.applicantForwards); a Partner
// (view-only) is refused by checkAdminRole. Audited on the tuition.

export const dynamic = 'force-dynamic'

const Body = z.object({
  jobId: uuid,
  channel: z.enum(['whatsapp', 'call', 'other']),
  tutorIds: z.array(uuid).min(1).max(100),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.applicantForwards)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const result = await recordForward({ actor: gate.actor, ...parsed.data })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true })
}
