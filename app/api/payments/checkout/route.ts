import { NextResponse } from 'next/server'
import { serverError } from '@/lib/errorResponse'
import { createClient } from '@/lib/supabase/server'
import { getProvider, newPaymentReference } from '@/lib/payments'
import { manual } from '@/lib/payments/manual'
import { pproVisibleFor, startPayproCheckout, toPayproMobile } from '@/lib/payments/paypro'
import { isSyntheticEmail } from '@/lib/phone'
import { logActivity } from '@/lib/activityLog'
import { parseBody, z, text } from '@/lib/validate'
import { rateLimit, tooManyRequests } from '@/lib/rateLimit'

// node:https (PayPro) needs the Node runtime, not edge.
export const runtime = 'nodejs'
// PayPro's own request timeout is 15s for the token and 15s for create-order
// (lib/payments/paypro rawRequest), so a slow gateway can need up to ~30s to
// return a CLEAN 502 "payment_failed". Without this the function was killed at
// the platform default and the client saw an opaque 504 → the onboarding final
// screen's generic "unavailable" (HOTFIX-G4b). 30s lets the real outcome return.
export const maxDuration = 30

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

const CheckoutBody = z.object({
  planCode: text({ min: 1, max: 64, label: 'Plan' }),
  // 'card' (default) → PayPro; 'transfer' → the bank/wallet transfer order page.
  method: z.enum(['card', 'transfer']).optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

  const limit = await rateLimit('payment', user.id)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'payment attempts')

  const parsed = await parseBody(request, CheckoutBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

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
    .select(
      'role, admin_role, is_seed, full_name, phone_number, email, utm_source, utm_medium, utm_campaign, utm_content',
    )
    .eq('id', user.id)
    .maybeSingle()

  // A member with no profile row has nothing to check out against.
  if (!profile) {
    return NextResponse.json({ error: 'Please complete your profile first.' }, { status: 403 })
  }

  // PR106-G2 §0: the launch-phase "test emails only" gate is GONE from the
  // top of the route. Bank TRANSFER is always available to any signed-in
  // member (it does not depend on the gateway), and CARD is open to EVERY
  // tutor the moment PayPro is LIVE — both decided below (pproVisibleFor /
  // the transfer branch), through the one onlinePaymentOpen() fact. A mobile
  // signup whose auth email is synthetic is no longer blocked.

  const audience = profile.role === 'tutor' ? 'tutor' : 'parent'
  if (plan.audience !== audience) {
    return NextResponse.json(
      { error: `${plan.name} is a ${plan.audience} plan; this is a ${audience} account.` },
      { status: 400 },
    )
  }

  // The Rs 199 verification fee is a ONE-TIME, lifetime entry fee (owner,
  // PR106-H3). Refuse a second checkout once it is paid — the flag is set by
  // activate.ts on approval, and an already-approved fee payment is the same
  // fact before the sweep runs. This is what stops a tutor being charged twice
  // for it (the Annie double-pay). A PENDING fee invoice is NOT blocked:
  // startPayproCheckout reuses a pending < 24h invoice, which is the legitimate
  // "continue your payment" path.
  if (audience === 'tutor' && plan.code === 'verified') {
    const { data: tp } = await supabase
      .from('tutor_profiles')
      .select('verified_fee_paid_at')
      .eq('id', user.id)
      .maybeSingle()
    const { data: approvedFee } = await supabase
      .from('payments')
      .select('id')
      .eq('user_id', user.id)
      .eq('plan_code', 'verified')
      .eq('status', 'approved')
      .limit(1)
      .maybeSingle()
    if (tp?.verified_fee_paid_at || approvedFee) {
      return NextResponse.json(
        {
          error: 'You have already paid the one-time Spam Free Platform Fee. Our team is reviewing your documents.',
          code: 'fee_already_paid',
          alreadyPaid: true,
          href: '/tutor/dashboard',
        },
        { status: 409 },
      )
    }
  }

  // VERIFICATION BEFORE PLAN (owner PR32 §3). A tutor cannot buy Premium or
  // Featured before the one-time Rs 199 verification fee is paid — a tutor is
  // never Premium/Featured while unverified. Send them to get verified first
  // (the fee flow), then back to the plan they chose. This is the server guard;
  // activate.ts additionally pauses any such plan that slips through a gateway,
  // so an unverified account can never hold an ACTIVE Premium/Featured.
  if (audience === 'tutor' && (plan.code === 'premium' || plan.code === 'featured')) {
    const { data: tp } = await supabase
      .from('tutor_profiles')
      .select('verified_fee_paid_at')
      .eq('id', user.id)
      .maybeSingle()
    if (!tp?.verified_fee_paid_at) {
      return NextResponse.json(
        {
          error: `Get verified first. ${plan.name} is for verified tutors — pay the one-time Spam Free Platform Fee, then choose ${plan.name}.`,
          needsVerify: true,
          planCode: plan.code,
          verifyHref: '/tutor/complete-profile?step=verify',
        },
        { status: 400 },
      )
    }
  }

  // The member can choose to pay by bank/wallet transfer instead of card. When
  // they do (or PayPro is not configured), we skip the gateway and send them to
  // the transfer order page. Default is card → PayPro.
  const wantsTransfer = body.method === 'transfer'

  // CARD via PayPro — open to EVERY tutor when the gateway is LIVE
  // (pproVisibleFor → onlinePaymentOpen). When it is not available for this
  // account (sandbox for a normal member / unconfigured), DO NOT fall through
  // to a dev simulator or a mislabelled row: tell the UI to use the always-
  // available bank transfer instead (the payment screen shows that card).
  if (!wantsTransfer) {
    if (!pproVisibleFor(profile)) {
      return NextResponse.json(
        {
          error: 'Online card payment isn’t open yet — please pay by bank transfer.',
          code: 'use_transfer',
        },
        { status: 409 },
      )
    }
    // The amount is the plan price read above — never the client's.
    const rawEmail = typeof profile.email === 'string' ? profile.email : ''
    const started = await startPayproCheckout({
      userId: user.id,
      planCode: plan.code as string,
      amountPkr: plan.price_pkr as number,
      customer: {
        name: (profile.full_name as string) ?? 'Customer',
        mobile: toPayproMobile(profile.phone_number as string | null),
        email: rawEmail && !isSyntheticEmail(rawEmail) ? rawEmail : '',
      },
      utm: {
        source: (profile.utm_source as string) ?? null,
        medium: (profile.utm_medium as string) ?? null,
        campaign: (profile.utm_campaign as string) ?? null,
        content: (profile.utm_content as string) ?? null,
      },
    })
    if (!started.ok) {
      // Never surface a database or gateway message to the member (PR66 §2).
      // HOTFIX-PAY2: distinguish PayPro being down (retry) from PayPro DECLINING
      // the order we sent (our bug) so the UI shows the honest line. The real
      // reason + message are logged for staff, never shown.
      console.error('[paypro] checkout start failed:', started.reason, started.error)
      const code = started.reason === 'unavailable' ? 'paypro_unavailable' : 'payment_failed'
      return NextResponse.json({ error: 'We could not start your payment.', code }, { status: started.status })
    }
    await logActivity({
      userId: user.id,
      event: 'payment_submitted',
      targetType: 'payment',
      targetId: started.paymentId,
      meta: { planCode: plan.code, provider: 'paypro', reference: started.reference, amountPkr: plan.price_pkr },
    })
    return NextResponse.json({
      mode: 'redirect',
      url: started.url,
      reference: started.reference,
      paymentId: started.paymentId,
    })
  }

  // Transfer path (or no gateway): force the manual provider so a transfer
  // choice always lands on the bank/wallet order page, never the dev simulator.
  const provider = wantsTransfer ? manual : getProvider()
  const reference = newPaymentReference()

  // Written with the member's own client, so RLS proves user_id = auth.uid()
  // and status = 'pending' rather than this route promising it.
  // The attribution carried on the ACCOUNT at the moment money moved, read
  // from the profile rather than from the cookie. The cookie expires after
  // thirty days and a tutor may upgrade months after signing up; the profile
  // holds the first touch permanently, which is the figure that answers "which
  // ad produced a paying member".
  const { data: acquisition } = await supabase
    .from('profiles')
    .select('utm_source, utm_medium, utm_campaign, utm_content')
    .eq('id', user.id)
    .maybeSingle()

  const { data: payment, error } = await supabase
    .from('payments')
    .insert({
      user_id: user.id,
      plan_code: plan.code,
      amount_pkr: plan.price_pkr,
      status: 'pending',
      provider: provider.id,
      provider_ref: reference,
      utm_source: acquisition?.utm_source ?? null,
      utm_medium: acquisition?.utm_medium ?? null,
      utm_campaign: acquisition?.utm_campaign ?? null,
      utm_content: acquisition?.utm_content ?? null,
      // `method` is the money instrument. A simulated purchase is pretending
      // to be the gateway, so it records the gateway.
      method: provider.id === 'manual' ? null : 'assanpay',
    })
    .select('id')
    .single()

  if (error) return serverError(error, 'payments/checkout')

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
