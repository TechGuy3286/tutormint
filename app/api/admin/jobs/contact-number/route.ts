import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseSupervisorTuitions } from '@/lib/supervisorScope'
import { saveTuitionContactNumber } from '@/lib/tuitionContact'
import { parseBody, z } from '@/lib/validate'

// POST /api/admin/jobs/contact-number (owner, 12 Oct 2026) — add or change the
// parent contact number on a staff-posted tuition, and (with resume) put a
// tuition paused for "No contact number" back live for a fresh 20 days on the
// same address. Every role that posts tuitions (SCREEN_ACCESS.jobsPost); the
// view-only Partner is refused by checkAdminRole; signed out 401. Audited.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({
  jobId: z.guid(),
  phone: z.string().max(40),
  resume: z.boolean().optional(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.jobsPost)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  // A Supervisor changes only their own tuitions and cities (owner, 24 Oct 2026).
  const scope = await refuseSupervisorTuitions(gate.actor, [parsed.data.jobId])
  if (scope) return scope
  const result = await saveTuitionContactNumber({ actor: gate.actor, jobId: parsed.data.jobId, phone: parsed.data.phone, resume: parsed.data.resume })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, resumed: result.resumed, canResume: result.canResume })
}
