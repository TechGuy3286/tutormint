import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { activatePayment, rejectPayment } from '@/lib/payments/activate'
import { requireFreshAuth } from '@/lib/reauth'
import { parseBody, z, uuid } from '@/lib/validate'

// Approve or reject a manual bank/wallet transfer (PR98 §4).
//
// Auto-activation was removed from /api/payments/manual, so a transfer sits
// 'pending' (= waiting for approval) until a person decides here. Approval runs
// the SAME activatePayment a gateway webhook runs — but WITH an actor, so it
// writes an admin_audit_log 'payment.approve' row; a manual transfer therefore
// cannot reach an active subscription without a recorded human approval.
//
// owner + admin only (SCREEN_ACCESS.paymentsApprove), and — because approving a
// payment grants money's worth of value — it requires a fresh password (reauth),
// the same gate as a plan grant or a suspension.

export const runtime = 'nodejs'

const DecideBody = z.object({
  paymentId: uuid,
  action: z.enum(['approve', 'reject'], { message: 'Choose approve or reject.' }),
  reason: z.string().max(1000, 'That reason is too long.').optional(),
})

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.paymentsApprove)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response

  const parsed = await parseBody(request, DecideBody)
  if (!parsed.ok) return parsed.response
  const { paymentId, action } = parsed.data
  const reason = (parsed.data.reason ?? '').trim()

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })

  // Only a manual transfer is decided here. A gateway payment activates via its
  // webhook; approving one by hand would be a second path to the same money.
  const { data: payment } = await admin
    .from('payments')
    .select('id, provider, status')
    .eq('id', paymentId)
    .maybeSingle()
  if (!payment) return NextResponse.json({ error: 'Payment not found.' }, { status: 404 })
  if (payment.provider !== 'manual') {
    return NextResponse.json(
      { error: 'Only a bank/wallet transfer is approved by hand. Card payments confirm automatically.' },
      { status: 400 },
    )
  }

  const actor = { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email }

  if (action === 'approve') {
    const result = await activatePayment({ paymentId, source: 'manual_approval', actor })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ ok: true, approved: true })
  }

  if (reason.length < 3) {
    return NextResponse.json({ error: 'Give a short reason the member can read.' }, { status: 400 })
  }
  const result = await rejectPayment({ paymentId, reason, actor })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status ?? 400 })
  return NextResponse.json({ ok: true, rejected: true })
}
