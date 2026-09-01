import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { simulatorEnabled } from '@/lib/payments'
import { signSimulatorPayload, SIMULATOR_SIGNATURE_HEADER } from '@/lib/payments/simulator'

// The fake gateway's "Pay success" / "Pay fail" buttons.
//
// This stands in for AssanPay's own servers, so it does what they will do: it
// signs a payload and POSTs it to our public webhook over HTTP. It does NOT
// call activatePayment() directly -- if it did, the thing being tested would
// be a shortcut rather than the code that runs in production, and a broken
// signature check or a broken idempotency guard would still look green.
//
// Disabled in production three times over (see lib/payments/simulator.ts) and
// scoped to the signed-in buyer's own reference, so even in a shared dev
// environment it cannot be aimed at somebody else's purchase.

export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (!simulatorEnabled()) {
    return NextResponse.json({ error: 'Not available.' }, { status: 404 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

  let body: { reference?: string; outcome?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const reference = String(body.reference ?? '')
  const outcome = body.outcome === 'success' ? 'success' : 'failed'

  const { data: payment } = await supabase
    .from('payments')
    .select('id, amount_pkr, provider')
    .eq('provider_ref', reference)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!payment || payment.provider !== 'simulator') {
    return NextResponse.json({ error: 'Payment not found.' }, { status: 404 })
  }

  const payload = JSON.stringify({
    reference,
    outcome,
    amountPkr: payment.amount_pkr,
    simulatedAt: new Date().toISOString(),
  })

  const origin = new URL(request.url).origin
  const hook = await fetch(`${origin}/api/payments/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [SIMULATOR_SIGNATURE_HEADER]: signSimulatorPayload(payload),
    },
    body: payload,
  })

  const result = await hook.json().catch(() => ({}))

  return NextResponse.json(
    { forwarded: true, webhookStatus: hook.status, webhook: result },
    { status: hook.ok ? 200 : 502 },
  )
}
