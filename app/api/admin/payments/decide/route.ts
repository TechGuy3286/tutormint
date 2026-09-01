import { NextResponse } from 'next/server'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { activatePayment, rejectPayment } from '@/lib/payments/activate'

// Approve or reject a manual transfer.
//
// Approving runs exactly the same activatePayment() a gateway webhook runs, so
// a bank-transfer member ends up with the identical subscription row, badge,
// notification and activity event as a card member. The only difference is
// that this path has an actor, and therefore writes an audit entry.
//
// owner / manager / finance only, checked here and not merely in the UI: a
// verifier who could POST this would be able to hand out plans.

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.paymentsMutate)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  let body: { paymentId?: string; action?: string; reason?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const paymentId = typeof body.paymentId === 'string' ? body.paymentId : ''
  if (!paymentId) return NextResponse.json({ error: 'Missing payment.' }, { status: 400 })

  const actor = { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email }

  if (body.action === 'approve') {
    const result = await activatePayment({ paymentId, source: 'manual_approval', actor })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({
      success: true,
      alreadyActive: result.alreadyActive,
      expiresAt: result.alreadyActive ? null : result.expiresAt,
    })
  }

  if (body.action === 'reject') {
    const reason = (body.reason ?? '').trim()
    // A rejection the member cannot understand is a support ticket, and they
    // have already sent money somewhere.
    if (reason.length < 5) {
      return NextResponse.json(
        { error: 'Give a reason the member can act on.' },
        { status: 400 },
      )
    }
    const result = await rejectPayment({ paymentId, reason, actor })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status ?? 400 })
    }
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}

