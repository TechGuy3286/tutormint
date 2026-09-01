import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyInboundWebhook } from '@/lib/payments'
import { activatePayment, rejectPayment } from '@/lib/payments/activate'

// The gateway callback. This route is what turns money into a plan, so it is
// the one place on the platform where an unauthenticated request has real
// power. Three properties hold it shut:
//
//   1. SIGNATURE. The body is HMAC'd with a shared secret and compared in
//      constant time. No signature, wrong signature, or a provider that is not
//      configured -> 401. There is no "unsigned but looks fine" path.
//
//   2. IDEMPOTENCE. The payment is found by the reference WE generated at
//      checkout, and activatePayment() returns early when it is already
//      approved. Gateways replay callbacks -- sometimes minutes later,
//      sometimes days -- and a replay must not mint a second month.
//
//   3. NO TRUST IN THE BODY. The plan and the amount come from our payment row
//      and the plans table, never from the payload. The only things read out
//      of the request are the reference and the outcome; a payload claiming
//      plan=featured cannot upgrade anyone.
//
// The raw body is read as text and passed through untouched. Re-serialising
// parsed JSON would change the bytes and break every signature.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const rawBody = await request.text()

  const event = await verifyInboundWebhook(request, rawBody)
  if (!event) {
    // Deliberately vague and deliberately 401: a forged callback learns
    // nothing about which check it failed.
    return NextResponse.json({ error: 'Unverified webhook.' }, { status: 401 })
  }

  const admin = createAdminClient()
  if (!admin) {
    // 503 rather than 200: the gateway should retry, not conclude we are done.
    return NextResponse.json({ error: 'Server not configured.' }, { status: 503 })
  }

  const { data: payment } = await admin
    .from('payments')
    .select('id, status, amount_pkr, plan_code')
    .eq('provider', event.provider)
    .eq('provider_ref', event.reference)
    .maybeSingle()

  if (!payment) {
    // A signed callback for a reference we never issued. 404 so the gateway
    // stops retrying, and it is logged because it should never happen.
    console.error('[webhook] verified event for unknown reference', event.provider, event.reference)
    return NextResponse.json({ error: 'Unknown reference.' }, { status: 404 })
  }

  // Keep the payload for reconciliation whatever the outcome.
  await admin
    .from('payments')
    .update({ raw: event.raw, updated_at: new Date().toISOString() })
    .eq('id', payment.id)

  if (event.outcome !== 'success') {
    await rejectPayment({
      paymentId: payment.id as string,
      reason: 'The payment was not completed. Nothing was charged and your plan is unchanged.',
    })
    return NextResponse.json({ received: true, activated: false })
  }

  // The gateway saying it collected less than the plan costs is not a partial
  // sale -- it is a discrepancy a human has to look at. Leave the payment
  // pending so it surfaces in the admin queue rather than half-activating.
  if (event.amountPkr !== null && event.amountPkr < (payment.amount_pkr as number)) {
    console.error(
      '[webhook] amount mismatch; leaving pending',
      event.reference,
      event.amountPkr,
      payment.amount_pkr,
    )
    return NextResponse.json({ received: true, activated: false, reason: 'amount_mismatch' })
  }

  const result = await activatePayment({ paymentId: payment.id as string, source: 'gateway' })

  if (!result.ok) {
    console.error('[webhook] activation failed', event.reference, result.error)
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({
    received: true,
    activated: !result.alreadyActive,
    idempotent: result.alreadyActive,
  })
}
