import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { requireFreshAuth } from '@/lib/reauth'
import { startViewAs } from '@/lib/viewAs'
import { parseBody, z, uuid } from '@/lib/validate'

// POST /api/admin/view-as/start { memberId } (owner, 26 Oct 2026) — "View as":
// the Owner sees the member's dashboard exactly as they do, read only, for 30
// minutes or until Exit (lib/viewAs, lib/viewAsCore). Owner only; the password
// is asked again. Signed out → 401.

export const dynamic = 'force-dynamic'

const Body = z.object({ memberId: uuid })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.memberMerge)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const refused = await refuseUnlessOwnerApproval(gate.actor, 'View a member’s account as them', null)
  if (refused) return refused
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response
  const res = await startViewAs(gate.actor, parsed.data.memberId)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ success: true, redirect: res.redirect })
}
