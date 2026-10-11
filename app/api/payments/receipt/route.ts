import { NextResponse } from 'next/server'
import { serverError } from '@/lib/errorResponse'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { newPaymentReference } from '@/lib/payments'
import { notify } from '@/lib/notifications'
import { logActivity } from '@/lib/activityLog'
import { rateLimit, tooManyRequests } from '@/lib/rateLimit'
import { sendBankTransferPending } from '@/lib/payments/paymentAlerts'
import { loadBankPanel, loadReceiptState } from '@/lib/payments/receipt'
import { RECEIPT_MESSAGES, RECEIPT_TYPES, receiptFileProblem } from '@/lib/payments/receiptCore'
import { FEE_LABEL } from '@/lib/display'

// Send a bank-transfer receipt (owner, 11 Oct 2026).
//
// The member chose "Other method" on the payment choice screen, sent the money
// from their own bank app, and uploads the receipt here. This records ONE
// pending bank-transfer payment for the package with the receipt attached and
// leaves it 'pending' = waiting for staff. NOTHING is activated here: the plan
// or the verification starts only when owner / admin / operations approve it on
// /admin/payments, which runs the same audited activation a gateway
// callback runs.
//
//   • The amount is read from `plans`, never from the request.
//   • A second receipt for the same package is refused while one is under review.
//   • The file goes to the PRIVATE payment-proofs bucket under a new name every
//     time, so a rejected receipt is never overwritten — it stays on record on
//     its own (rejected) payment row. It is read only through
//     /api/payments/proof/[id] (the member who sent it, or payments staff).
//   • Replaces /api/payments/manual, whose update wrote method 'transfer' — a
//     value payments_method_check refuses — so it never recorded a transfer.

export const runtime = 'nodejs'

const SIGN_IN = 'Please sign in first, then try again.\nپہلے سائن ان کریں، پھر دوبارہ کوشش کریں۔'
const NOT_WORKING =
  'This is not working right now. Please try again in a few minutes, or message us on WhatsApp 0321 5872222.\nیہ ابھی کام نہیں کر رہا۔ کچھ منٹ بعد کوشش کریں یا واٹس ایپ پر پیغام کریں۔'

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: SIGN_IN }, { status: 401 })

  const limit = await rateLimit('payment', user.id)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'payment attempts')

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: receiptFileProblem(null) }, { status: 400 })
  }

  const planCode = String(form.get('planCode') ?? '').trim()
  const transactionId = String(form.get('transactionId') ?? '').trim().slice(0, 80)
  const file = form.get('receipt')

  const problem = receiptFileProblem(file instanceof File ? { type: file.type, size: file.size } : null)
  if (problem || !(file instanceof File)) return NextResponse.json({ error: problem }, { status: 400 })

  const { data: plan } = await supabase
    .from('plans')
    .select('code, name, audience, price_pkr')
    .eq('code', planCode)
    .maybeSingle()
  if (!plan || !(plan.price_pkr as number)) {
    return NextResponse.json({ error: 'Choose a package first.\nپہلے پیکج منتخب کریں۔' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name, utm_source, utm_medium, utm_campaign, utm_content')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile) return NextResponse.json({ error: 'Please complete your profile first.' }, { status: 403 })

  const audience = profile.role === 'tutor' ? 'tutor' : 'parent'
  if (plan.audience !== audience) {
    return NextResponse.json({ error: `${plan.name} is a ${plan.audience} plan; this is a ${audience} account.` }, { status: 400 })
  }

  // The same two rules the checkout route applies: the fee is paid once, and a
  // tutor plan needs the fee first.
  if (audience === 'tutor') {
    const { data: tp } = await supabase.from('tutor_profiles').select('verified_fee_paid_at').eq('id', user.id).maybeSingle()
    const feePaid = !!tp?.verified_fee_paid_at
    if (plan.code === 'verified' && feePaid) {
      return NextResponse.json(
        { error: `You have already paid the one-time ${FEE_LABEL}.`, code: 'fee_already_paid', href: '/tutor/dashboard' },
        { status: 409 },
      )
    }
    if (plan.code !== 'verified' && !feePaid) {
      return NextResponse.json(
        { error: `Get verified first. ${plan.name} is for verified tutors.`, needsVerify: true },
        { status: 400 },
      )
    }
  }

  // "Other method" exists only while the owner's switch is on and the bank
  // details are filled in — refused here, not only hidden on the screen.
  if (!(await loadBankPanel())) {
    return NextResponse.json({ error: RECEIPT_MESSAGES.bankOff, code: 'method_off' }, { status: 400 })
  }

  const state = await loadReceiptState(user.id, plan.code as string)
  if (state.state === 'under_review') {
    return NextResponse.json({ error: RECEIPT_MESSAGES.alreadyUnderReview, code: 'under_review' }, { status: 409 })
  }

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: NOT_WORKING }, { status: 503 })

  // Reuse an order the member started and never sent proof for; else a new one.
  // Inserted with the member's own client, so RLS proves user_id and 'pending'.
  const { data: open } = await supabase
    .from('payments')
    .select('id, provider_ref')
    .eq('user_id', user.id)
    .eq('plan_code', plan.code as string)
    .eq('provider', 'manual')
    .eq('status', 'pending')
    .is('screenshot_path', null)
    .is('reference', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let paymentId = (open?.id as string | undefined) ?? null
  let reference = (open?.provider_ref as string | undefined) ?? null
  if (!paymentId) {
    reference = newPaymentReference()
    const { data: created, error: insertError } = await supabase
      .from('payments')
      .insert({
        user_id: user.id,
        plan_code: plan.code,
        amount_pkr: plan.price_pkr,
        status: 'pending',
        provider: 'manual',
        provider_ref: reference,
        utm_source: profile.utm_source ?? null,
        utm_medium: profile.utm_medium ?? null,
        utm_campaign: profile.utm_campaign ?? null,
        utm_content: profile.utm_content ?? null,
      })
      .select('id')
      .single()
    if (insertError || !created) return serverError(insertError ?? new Error('no payment row'), 'payments/receipt')
    paymentId = created.id as string
  }

  // A new object name per upload: nothing already on record is ever replaced.
  const path = `${user.id}/${paymentId}-${Date.now()}.${RECEIPT_TYPES[file.type]}`
  const { error: uploadError } = await admin.storage
    .from('payment-proofs')
    .upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type, upsert: false })
  if (uploadError) return serverError(uploadError, 'payments/receipt')

  // Service role for COLUMN control (payments has no member UPDATE policy, on
  // purpose); ownership was established above with the member's own client.
  const { error: updateError } = await admin
    .from('payments')
    .update({
      // 'bank' is the value payments_method_check allows for a bank transfer.
      method: 'bank',
      reference: transactionId || null,
      screenshot_path: path,
      updated_at: new Date().toISOString(),
    })
    .eq('id', paymentId)
    .eq('user_id', user.id)
    .eq('status', 'pending')
  if (updateError) return serverError(updateError, 'payments/receipt')

  const isFee = plan.code === 'verified'
  await notify({
    userId: user.id,
    kind: 'payment_submitted',
    title: 'Receipt received',
    body: isFee
      ? 'We have your bank transfer receipt. We will check it and activate your verification soon.'
      : `We have your bank transfer receipt. We will check it and activate your ${plan.name} plan soon.`,
    href: `/pay/choose?plan=${encodeURIComponent(plan.code as string)}`,
  })

  await logActivity({
    userId: user.id,
    event: 'payment_submitted',
    targetType: 'payment',
    targetId: paymentId,
    meta: { planCode: plan.code, provider: 'manual', reference, awaitingApproval: true, receipt: true },
  })

  await sendBankTransferPending({
    memberName: (profile.full_name as string) ?? 'A member',
    role: audience === 'tutor' ? 'Tutor' : 'Parent',
    amountPkr: (plan.price_pkr as number) ?? 0,
  })

  return NextResponse.json({
    success: true,
    underReview: true,
    message: isFee ? RECEIPT_MESSAGES.received : RECEIPT_MESSAGES.receivedPlan,
  })
}
