import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { requireFreshAuth } from '@/lib/reauth'
import { restoreStaffAccess } from '@/lib/formerStaff'
import { parseBody, z, uuid } from '@/lib/validate'

// POST /api/admin/members/restore-staff — the Owner's "Restore staff access"
// for a former staff member (owner, 24 Oct 2026; lib/formerStaff). Owner only:
// the Partner views (roleMayWrite refuses the team list), everyone else 403.
// Fresh password required, like every other staff change. Audited.

const Body = z.object({ memberId: uuid })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.team)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const refused = await refuseUnlessOwnerApproval(gate.actor, 'restore staff access', null)
  if (refused) return refused
  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const r = await restoreStaffAccess(gate.actor, parsed.data.memberId)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ success: true, role: r.role })
}
