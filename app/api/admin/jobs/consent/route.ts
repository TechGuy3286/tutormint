import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseSupervisorTuitions } from '@/lib/supervisorScope'
import { recordConsent } from '@/lib/tuitionConsent'
import { isStaffConsentMethod } from '@/lib/tuitionConsentCore'
import { parseBody, z, uuid } from '@/lib/validate'

// POST /api/admin/jobs/consent { jobId, method, note?, via? } (owner, 27 Oct 2026)
//
// "Parent agreed" on a "Consent not recorded" chip (admin tuition cards and
// Applications): records the consent with how they agreed. Every role that
// posts tuitions (SCREEN_ACCESS.tuitionConsent); a Manager only on their own
// tuitions. Written to Audit (job.consent_record) — never a phone number.

export const dynamic = 'force-dynamic'

const Body = z.object({
  jobId: uuid,
  method: z.string().max(40),
  note: z.string().max(500).nullish(),
  via: z.enum(['chip', 'applications']).optional(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.tuitionConsent)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const { jobId, method, note, via } = parsed.data
  if (!isStaffConsentMethod(method)) {
    return NextResponse.json({ error: 'Choose how the parent agreed: phone call, WhatsApp or in person.' }, { status: 400 })
  }
  const scope = await refuseSupervisorTuitions(gate.actor, [jobId])
  if (scope) return scope
  const r = await recordConsent(gate.actor, jobId, { method, note: note ?? null }, via ?? 'chip')
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ success: true, changed: r.changed })
}
