import { NextResponse } from 'next/server'

import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { undoDecision } from '@/lib/paymentDecisionUndo'
import { parseBody, z, uuid } from '@/lib/validate'

// The 10-second Undo after Approve or Reject on a payment (owner, 17 Nov 2026 —
// PR-03). Only the person who decided, within a minute (the button shows for
// 10 seconds). The same roles that may decide: the Owner, and the staff who
// may approve a bank-matched receipt. Audited payment.approve_undo /
// payment.reject_undo.

export const runtime = 'nodejs'

const Body = z.object({ paymentId: uuid })

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.paymentsApprove, ...SCREEN_ACCESS.receiptStaffApprove)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response
  const r = await undoDecision(parsed.data.paymentId, { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, undid: r.undid })
}
