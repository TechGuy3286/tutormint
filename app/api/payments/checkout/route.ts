import { NextResponse } from 'next/server'
import { serverError } from '@/lib/errorResponse'
import { createClient } from '@/lib/supabase/server'
import { getProvider, newPaymentReference } from '@/lib/payments'
import { manual } from '@/lib/payments/manual'
import { logActivity } from '@/lib/activityLog'
import { parseBody, z, text } from '@/lib/validate'
import { rateLimit, tooManyRequests } from '@/lib/rateLimit'
import { bankTransferOn, getGatewaySettings } from '@/lib/payments/gatewaySettings'
import { PAYPRO_CLOSED_MESSAGE } from '@/lib/payments/payproRetireCore'
import { RELOAD_AND_RETRY } from '@/lib/tutorSubjectCap'
import { upgradeRefusal } from '@/lib/upgradesPausedCore'
import { downgradeRefusal } from '@/lib/planPurchaseCore'
import { planChangeFor } from '@/lib/planPurchase'

export const runtime = 'nodejs'
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
  // 'transfer' → the bank/wallet transfer order page; 'card' is refused (PayPro ended).
  method: z.enum(['card', 'transfer'], { message: RELOAD_AND_RETRY }).optional(),
  // The page to come back to after paying the fee (owner, 15 Oct 2026).
  returnTo: z.string({ message: RELOAD_AND_RETRY }).max(512, { message: RELOAD_AND_RETRY }).optional(),
}, { message: RELOAD_AND_RETRY })

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Please sign in first, then try again.' }, { status: 401 })

  const limit = await rateLimit('payment', user.id)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'payment attempts')

  const parsed = await parseBody(request, CheckoutBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const planCode = typeof body.planCode === 'string' ? body.planCode.trim() : ''
  if (!planCode) return NextResponse.json({ error: 'Choose a plan.' }, { status: 400 })

  const { data: plan } = await supabase
    .from('plans')
    .select('code, name, audience, price_pkr, search_rank')
    .eq('code', planCode)
    .maybeSingle()

  if (!plan) return NextResponse.json({ error: 'Unknown plan.' }, { status: 400 })

  // A paused plan (tutor Featured since PR-13) cannot be bought; the Verification
  // Fee and the plans on sale can. Refused before any payment row is made.
  const paused = upgradeRefusal(plan.code as string, plan.price_pkr as number)
  if (paused) return NextResponse.json({ error: paused.error, code: paused.code }, { status: paused.status })

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

  // Bank TRANSFER is available to any signed-in member (PayPro card checkout
  // ended — PR-12). A mobile signup whose auth email is synthetic is not blocked.

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
  // for it (the Annie double-pay).
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
          error: 'You have already paid the one-time Verification Fee. Our team is reviewing your documents.',
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
          error: `Get verified first. ${plan.name} is for verified tutors — pay the one-time Verification Fee, then choose ${plan.name}.`,
          needsVerify: true,
          planCode: plan.code,
          verifyHref: '/tutor/complete-profile?step=verify',
        },
        { status: 400 },
      )
    }
  }

  // No downgrades (PR-13): a member on a higher running plan cannot buy a lower
  // one. The same plan extends it; a higher one replaces it on approval.
  if (plan.code !== 'verified') {
    const { change } = await planChangeFor(user.id, audience, { code: plan.code as string, rank: (plan.search_rank as number) ?? 0 })
    const down = downgradeRefusal(change)
    if (down) return NextResponse.json({ error: down.error, code: down.code }, { status: down.status })
  }

  // Bank/wallet transfer is the only way to pay (PayPro ended, PR-12): the
  // member is sent to the transfer order page.
  const wantsTransfer = body.method === 'transfer'

  // Payment gateways (owner, 6 Oct 2026, item 19): a method the owner has turned
  // off is refused HERE, not only hidden on the screen.
  const gateways = await getGatewaySettings()
  const transferOn = bankTransferOn(gateways)
  if (wantsTransfer && !transferOn) {
    return NextResponse.json(
      {
        error: 'Bank transfer is not available right now. Please pay online instead.',
        code: 'method_off',
      },
      { status: 400 },
    )
  }
  // PayPro has ended (owner, 20 Nov 2026 — PR-12; checkout retired 26 Oct):
  // every payment is a bank transfer with a receipt. A card request is refused
  // with the plain "pay by bank transfer" line.
  if (!wantsTransfer) {
    return NextResponse.json({ error: PAYPRO_CLOSED_MESSAGE, code: 'use_transfer' }, { status: 409 })
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
      method: null,
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
    next: `/pay/choose?plan=${encodeURIComponent(plan.code as string)}`,
  })
}
