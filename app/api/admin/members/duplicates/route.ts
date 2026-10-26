import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { dismissPair } from '@/lib/memberDuplicates'
import { parseBody, z, uuid } from '@/lib/validate'

// POST /api/admin/members/duplicates { action: 'dismiss', aId, bId, reason }
// (owner, 26 Oct 2026) — "Not a duplicate": the warning for that pair is hidden
// for good (member_duplicate_dismissals) and logged on both accounts. Owner only.

export const dynamic = 'force-dynamic'

const Body = z.object({
  action: z.literal('dismiss'),
  aId: uuid,
  bId: uuid,
  reason: z.enum(['mobile', 'cnic', 'name']).nullish(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.memberMerge)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const refused = await refuseUnlessOwnerApproval(gate.actor, 'Mark two accounts as not a duplicate', null)
  if (refused) return refused
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const b = parsed.data
  if (b.aId === b.bId) return NextResponse.json({ error: 'Pick two different accounts.' }, { status: 400 })
  const res = await dismissPair(gate.actor, b.aId, b.bId, b.reason ?? null)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ success: true })
}
