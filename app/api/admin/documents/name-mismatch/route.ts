import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { docDecider } from '@/lib/docDecisionCore'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { markCnicNameMismatch } from '@/lib/staffDocDecisions'
import { parseBody, z, uuid } from '@/lib/validate'

// "Name does not match" on a CNIC (owner, 5 Nov 2026): the reviewer (the Owner
// or Backend Support) marks that the name on the card is not the member's Name
// on CNIC. The CNIC is then the Owner's to decide (lib/docDecisionCore). Only
// the Owner clears the mark; an Owner decision on the CNIC clears it too.

export const dynamic = 'force-dynamic'

const Body = z.object({ memberId: uuid, mismatch: z.boolean() })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.tutors, ...SCREEN_ACCESS.parents, ...SCREEN_ACCESS.documentDecide)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const decider = docDecider(gate.actor.adminRole)
  if (!decider || (!parsed.data.mismatch && decider !== 'owner')) {
    const refused = await refuseUnlessOwnerApproval(gate.actor, parsed.data.mismatch ? 'mark a CNIC name as not matching' : 'clear a CNIC name mismatch', parsed.data.memberId)
    if (refused) return refused
  }
  const r = await markCnicNameMismatch(parsed.data.memberId, parsed.data.mismatch, { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true })
}
