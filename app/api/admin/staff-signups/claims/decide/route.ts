import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { decideClaim } from '@/lib/staffSignups'
import { parseBody, z, uuid } from '@/lib/validate'

// Claims to review (owner, 15 Oct 2026): the Owner and Admin approve or reject
// with one click and an optional reason. The Project Managers view (refused
// here by checkAdminRole). Nobody decides their own claim. Audited.

export const dynamic = 'force-dynamic'

const Body = z.object({
  claimId: uuid,
  decision: z.enum(['approve', 'reject']),
  reason: z.string().max(500).nullable().optional(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.staffClaimsReview)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  // Owner-only approvals (owner, 15 Oct 2026): every other role views only.
  const notOwner = await refuseUnlessOwnerApproval(gate.actor, `${parsed.data.decision} a staff sign-up claim`, null)
  if (notOwner) return notOwner

  const result = await decideClaim(gate.actor, parsed.data.claimId, parsed.data.decision === 'approve', parsed.data.reason ?? null)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, status: result.status })
}
