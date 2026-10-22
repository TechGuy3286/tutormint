import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { reassignOwner } from '@/lib/applicationTracking'
import { parseBody, z, uuid } from '@/lib/validate'

// POST /api/admin/applications/owner (owner, 22 Oct 2026)
//
// Reassign the staff owner of one tuition or many (bulk). ONLY the site Owner —
// lib/applicationStageCore mayReassign; everyone else gets 403. `staffId` null
// = Unassigned. Each change is in admin_audit_log as job.owner_assign.

export const dynamic = 'force-dynamic'

const Body = z.object({
  jobIds: z.array(uuid).min(1).max(500),
  staffId: uuid.nullable(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.applicantForwards)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const result = await reassignOwner({ actor: gate.actor, ...parsed.data })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, changed: result.changed })
}
