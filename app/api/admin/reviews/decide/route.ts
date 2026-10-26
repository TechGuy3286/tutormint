import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { decideReview } from '@/lib/reviews'
import { parseBody, z, uuid } from '@/lib/validate'

// POST /api/admin/reviews/decide { reviewId, decision: approve | reject, reason? }
// (owner, 27 Oct 2026) — Trust → Reviews. Only the site Owner approves or
// rejects a parent review (refuseUnlessOwnerApproval: anyone else 403 and the
// Owner is alerted); a review is decided once; every decision is in Audit.
// Only an approved review is public and counts in the tutor's rating.
// Signed out → 401.

export const dynamic = 'force-dynamic'

const Body = z.object({
  reviewId: uuid,
  decision: z.enum(['approve', 'reject']),
  reason: z.string().max(300).optional().nullable(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.reviews)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const refused = await refuseUnlessOwnerApproval(gate.actor, 'Approve or reject a parent review', null)
  if (refused) return refused
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const res = await decideReview(gate.actor, parsed.data.reviewId, parsed.data.decision, parsed.data.reason ?? null)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ success: true })
}
