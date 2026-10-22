import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { otherOpenApplications } from '@/lib/applicationTracking'
import { uuid } from '@/lib/validate'

// GET /api/admin/applications/others?applicationId=… (owner, 22 Oct 2026)
// The tuition's OTHER applications still moving — listed by the Hired
// confirmation, which offers to mark them Not selected. Names only, no phones.

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.applicantForwards)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const id = uuid.safeParse(new URL(request.url).searchParams.get('applicationId'))
  if (!id.success) return NextResponse.json({ error: 'Something in that request was missing. Reload the page and try again.' }, { status: 400 })
  return NextResponse.json({ others: await otherOpenApplications(id.data) }, { headers: { 'Cache-Control': 'private, no-store' } })
}
