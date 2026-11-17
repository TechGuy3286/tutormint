import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { refuseUnlessOwnerApproval } from '@/lib/ownerGuard'
import { requireFreshAuth } from '@/lib/reauth'
import { reopenPayment } from '@/lib/paymentDecisionUndo'
import { parseBody, z, uuid } from '@/lib/validate'

// "Reopen" on a rejected bank-transfer receipt (owner, 17 Nov 2026 — PR-03).
// OWNER ONLY, a reason required, fresh password; audited payment.reopen. The
// receipt goes back to "Waiting for approval". Nothing is deleted.

export const runtime = 'nodejs'

const Body = z.object({ paymentId: uuid, reason: z.string().min(3, 'Give a short reason.').max(500, 'That reason is too long.') })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.paymentsApprove)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const notOwner = await refuseUnlessOwnerApproval(gate.actor, 'reopen a rejected receipt', null)
  if (notOwner) return notOwner
  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const r = await reopenPayment(parsed.data.paymentId, parsed.data.reason, { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true })
}
