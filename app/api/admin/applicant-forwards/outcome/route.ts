import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { recordOutcome } from '@/lib/applicantForwards'
import { parseBody, z, uuid } from '@/lib/validate'

// The outcome of a forward on Marketplace → Applicants to forward (owner,
// 10 Oct 2026): Hired or Demo arranged (which tutor), Not interested, or No
// answer, with an optional note. Same access as forwarding
// (SCREEN_ACCESS.applicantForwards); a Partner is refused by checkAdminRole.
// Audited on the tuition. Nothing is shown to the tutor or the parent.

export const dynamic = 'force-dynamic'

const Body = z.object({
  jobId: uuid,
  outcome: z.enum(['hired', 'demo', 'not_interested', 'no_answer']),
  tutorId: uuid.nullable().optional(),
  note: z.string().max(500).nullable().optional(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.applicantForwards)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const result = await recordOutcome({
    actor: gate.actor,
    jobId: parsed.data.jobId,
    outcome: parsed.data.outcome,
    tutorId: parsed.data.tutorId ?? null,
    note: parsed.data.note ?? null,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true })
}
