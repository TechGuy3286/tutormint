import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { relabelCredit } from '@/lib/feeMatch'
import { CREDIT_LABELS } from '@/lib/feeMatchCore'
import { parseBody, z } from '@/lib/validate'

// Re-label a bank credit (owner, 27 Oct 2026): PayPro payout · Bank transfer
// from a member · Owner / partner transfer (not revenue). OWNER ONLY, a reason
// is required, audit-logged (settlement.relabel). An owner / partner transfer
// drops out of PayPro settlement, revenue and every money total.

export const runtime = 'nodejs'

const Body = z.object({
  transferId: z.guid(),
  to: z.enum(Object.keys(CREDIT_LABELS) as [keyof typeof CREDIT_LABELS, ...(keyof typeof CREDIT_LABELS)[]]),
  reason: z.string().min(3, 'Add a short reason.').max(500, 'Keep the reason under 500 characters.'),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.finance)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const notOwner = await refuseUnlessOwnerApproval(gate.actor, 're-label a bank credit', null)
  if (notOwner) return notOwner
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const r = await relabelCredit(parsed.data, { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true })
}
