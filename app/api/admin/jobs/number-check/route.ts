import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { parseBody, z } from '@/lib/validate'
import { parseContactNumber } from '@/lib/tuitionContactCore'
import { auditNumberBlocked, checkNumberFirst } from '@/lib/numberFirst'

// POST /api/admin/jobs/number-check — "Number first" on staff Post a tuition
// and the admin edit (owner, 31 Oct 2026). Step one of the form: the server
// checks the parent's number before the rest of the form opens. Answers one of
// the outcomes in lib/numberFirstCore; the number itself is never returned
// (only masked) and a refused number is audited without it. The save paths
// (createTeamJob / updateTeamJob) re-check as the backup.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({
  phone: z.string().max(40),
  jobId: z.string().uuid().nullable().optional(),
  where: z.enum(['post', 'edit']).optional(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.jobsPost)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const number = parseContactNumber(parsed.data.phone)
  if (!number.ok) return NextResponse.json({ error: number.error }, { status: 400 })

  const outcome = await checkNumberFirst(number.msisdn, { excludeJobId: parsed.data.jobId ?? null })
  if (!outcome) {
    return NextResponse.json({ error: 'We could not check this number just now. Please try again.' }, { status: 503 })
  }
  if (outcome.kind === 'do_not_use' || outcome.kind === 'on_hold') {
    await auditNumberBlocked(
      { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email },
      number.msisdn,
      outcome.kind,
      parsed.data.where ?? 'post',
    )
  }
  return NextResponse.json({ outcome }, { headers: { 'cache-control': 'no-store' } })
}
