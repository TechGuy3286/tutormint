import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getProvider, newPaymentReference } from '@/lib/payments'
import { logActivity } from '@/lib/activityLog'

// Start a purchase.
//
// This route creates the pending payment row and hands back either a gateway
// URL or "go and make a transfer". It never activates anything: the plan only
// starts when a verified webhook or an audited admin approval calls
// lib/payments/activate.ts.
//
// The amount is read from the `plans` table on the server. A price in the
// request body would be a price the buyer chooses.
//
// The payment row is created BEFORE the redirect, with our own reference on
// it. That reference is what makes the webhook idempotent -- one row per
// reference, and activation checks its status first -- and it also means a
// member who pays and then closes the tab has a record we can reconcile
// against, rather than money with nothing to attach it to.

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

  let body: { planCode?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const planCode = typeof body.planCode === 'string' ? body.planCode.trim() : ''
  if (!planCode) return NextResponse.json({ error: 'Choose a plan.' }, { status: 400 })

  const { data: plan } = await supabase
    .from('plans')
    .select('code, name, audience, price_pkr')
    .eq('code', planCode)
    .maybeSingle()

  if (!plan) return NextResponse.json({ error: 'Unknown plan.' }, { status: 400 })

  if (plan.price_pkr === 0) {
    // parent_verified costs nothing and is earned by CNIC + address approval,
    // not bought. Selling it would take money for something already free.
    return NextResponse.json(
      { error: 'That plan is free — verify your CNIC and address to get it.', href: '/parent/verify' },
      { status: 400 },
    )
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  const audience = profile?.role === 'tutor' ? 'tutor' : 'parent'
  if (plan.audience !== audience) {
    return NextResponse.json(
      { error: `${plan.name} is a ${plan.audience} plan; this is a ${audience} account.` },
      { status: 400 },
    )
  }

  const provider = getProvider()
  const reference = newPaymentReference()

  // Written with the member's own client, so RLS proves user_id = auth.uid()
  // and status = 'pending' rather than this route promising it.
  const { data: payment, error } = await supabase
    .from('payments')
    .insert({
      user_id: user.id,
      plan_code: plan.code,
      amount_pkr: plan.price_pkr,
      status: 'pending',
      provider: provider.id,
      provider_ref: reference,
      // `method` is the money instrument. A simulated purchase is pretending
      // to be the gateway, so it records the gateway.
      method: provider.id === 'manual' ? null : 'assanpay',
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const origin = new URL(request.url).origin

  let checkout
  try {
    checkout = await provider.createCheckout({
      paymentId: payment.id as string,
      reference,
      planCode: plan.code as string,
      planName: plan.name as string,
      amountPkr: plan.price_pkr as number,
      userId: user.id,
      origin,
    })
  } catch (e) {
    // The gateway refused before the member saw anything. Leave no pending
    // row implying they owe us money.
    await supabase.from('payments').delete().eq('id', payment.id)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not start the payment.' },
      { status: 502 },
    )
  }

  await logActivity({
    userId: user.id,
    event: 'payment_submitted',
    targetType: 'payment',
    targetId: payment.id as string,
    meta: { planCode: plan.code, provider: provider.id, reference, amountPkr: plan.price_pkr },
  })

  if (checkout.kind === 'redirect') {
    return NextResponse.json({
      mode: 'redirect',
      url: checkout.url,
      reference,
      paymentId: payment.id,
    })
  }

  return NextResponse.json({
    mode: 'manual',
    reference,
    paymentId: payment.id,
    next: `/pay/manual/${encodeURIComponent(reference)}`,
  })
}
