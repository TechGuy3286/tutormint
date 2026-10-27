import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { requireFreshAuth } from '@/lib/reauth'
import { loadFeeRange, saveFeeRange } from '@/lib/feeMatch'
import { parseBody, z } from '@/lib/validate'

// The "Fee match range" (owner, 27 Oct 2026; default Rs 199–210): a bank
// credit in it counts as a Verification Fee payment, the extra is rounding.
// Reading is the Finance screen's; saving is OWNER ONLY with a fresh password,
// audit-logged (settings.fee_match_range).

export const runtime = 'nodejs'

export async function GET() {
  const gate = await checkAdminRole(...SCREEN_ACCESS.finance)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  return NextResponse.json({ range: await loadFeeRange() })
}

const Body = z.object({ min: z.number().positive('Enter both amounts.').max(100_000), max: z.number().positive('Enter both amounts.').max(100_000) })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.finance)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const notOwner = await refuseUnlessOwnerApproval(gate.actor, 'change the fee match range', null)
  if (notOwner) return notOwner
  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const r = await saveFeeRange(parsed.data.min, parsed.data.max, { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, range: await loadFeeRange() })
}
