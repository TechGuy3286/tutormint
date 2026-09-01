import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/activityLog'
import { notify } from '@/lib/notifications'

// Submit a bank / JazzCash / Easypaisa transfer for review.
//
// The pending payment row already exists (created by /api/payments/checkout);
// this attaches the member's own transaction reference and their screenshot,
// and leaves it pending. Approval is a human decision on /admin/payments.
//
// Nothing here activates a plan, and the copy the member sees never promises
// one will appear instantly -- CLAUDE.md is explicit that "usually activated
// within a few hours" is the honest line for a manual transfer.
//
// The screenshot goes to the PRIVATE payment-proofs bucket. It shows an
// account number and usually a name, so there is no public URL to it: the
// finance admin reads it through /api/payments/proof/[id].

export const runtime = 'nodejs'

const ALLOWED_METHODS = new Set(['bank', 'jazzcash', 'easypaisa'])
const MAX_BYTES = 8 * 1024 * 1024

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 })
  }

  const reference = String(form.get('reference') ?? '').trim()
  const method = String(form.get('method') ?? '').trim()
  const payerReference = String(form.get('payerReference') ?? '').trim()
  const file = form.get('screenshot')

  if (!reference) return NextResponse.json({ error: 'Missing payment reference.' }, { status: 400 })
  if (!ALLOWED_METHODS.has(method)) {
    return NextResponse.json({ error: 'Choose how you paid.' }, { status: 400 })
  }
  if (payerReference.length < 4) {
    return NextResponse.json(
      { error: 'Enter the transaction ID from your transfer receipt.' },
      { status: 400 },
    )
  }

  // Scoped to this user: someone else's reference simply does not match.
  const { data: payment } = await supabase
    .from('payments')
    .select('id, user_id, plan_code, amount_pkr, status')
    .eq('provider_ref', reference)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!payment) return NextResponse.json({ error: 'Payment not found.' }, { status: 404 })
  if (payment.status !== 'pending') {
    return NextResponse.json(
      { error: 'That payment has already been reviewed.' },
      { status: 409 },
    )
  }

  let screenshotPath: string | null = null

  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'That image is larger than 8 MB.' }, { status: 400 })
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'The receipt must be an image.' }, { status: 400 })
    }

    const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const path = `${user.id}/${payment.id}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('payment-proofs')
      .upload(path, new Uint8Array(await file.arrayBuffer()), {
        contentType: file.type,
        upsert: true,
      })

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 400 })
    }
    screenshotPath = path
  }

  // Written with the service-role client, NOT the member's own.
  //
  // `payments` has an INSERT policy for the owner and an UPDATE policy for
  // admins, and deliberately no member UPDATE policy: a member who could
  // update their own pending payment could also change its plan_code from
  // `verified` to `featured` and have a finance admin approve 999 of value
  // against a 199 transfer. RLS cannot express "these three columns only".
  //
  // Authorisation still happened above, and with the member's own client --
  // the payment was fetched with .eq('user_id', user.id), so a reference
  // belonging to somebody else never reaches this line. What the service role
  // buys is column control, not a shortcut past the ownership check.
  const admin = createAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'Server is not configured.' }, { status: 503 })
  }

  const { data: updated, error } = await admin
    .from('payments')
    .update({
      method,
      reference: payerReference,
      screenshot_path: screenshotPath,
      updated_at: new Date().toISOString(),
    })
    .eq('id', payment.id)
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // An update that matches no rows is not an error in PostgREST. Saying
  // "received" when nothing was stored is how a member waits for a review
  // that will never come, so check rather than assume.
  if (!updated || updated.length === 0) {
    return NextResponse.json(
      { error: 'That payment could not be updated. Please contact support.' },
      { status: 409 },
    )
  }

  await notify({
    userId: user.id,
    kind: 'payment_submitted',
    title: 'Payment details received',
    body: 'Our team will confirm your transfer, usually within a few hours. Your plan starts as soon as it is confirmed.',
    href: '/pay/return?ref=' + encodeURIComponent(reference),
  })

  await logActivity({
    userId: user.id,
    event: 'payment_submitted',
    targetType: 'payment',
    targetId: payment.id as string,
    meta: {
      planCode: payment.plan_code,
      provider: 'manual',
      method,
      reference,
      hasScreenshot: !!screenshotPath,
    },
  })

  return NextResponse.json({ success: true, reference })
}
