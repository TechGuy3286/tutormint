import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { activatePayment } from '@/lib/payments/activate'
import { rateLimit, tooManyRequests } from '@/lib/rateLimit'

// Submit a bank / JazzCash / Easypaisa transfer — and activate it now (PR30).
//
// There is no longer a human approval step. The pending payment row created by
// /api/payments/checkout is finished here: this attaches the member's own
// transaction reference and screenshot, then runs the SAME activatePayment() a
// gateway webhook runs, so the plan starts the moment they submit and a
// transfer-paid member ends up with the identical subscription, badge and
// receipt as a gateway-paid one. No second activation path is written.
//
// IDEMPOTENT. A double tap cannot activate twice: activatePayment returns
// alreadyActive for a payment that is already approved, and an already-approved
// payment short-circuits at the top here — so no duplicate subscription, no
// second month.
//
// The screenshot goes to the PRIVATE payment-proofs bucket. It shows an
// account number and usually a name, so there is no public URL to it: it is read
// only through /api/payments/proof/[id].

export const runtime = 'nodejs'

const ALLOWED_METHODS = new Set(['bank', 'jazzcash', 'easypaisa'])
const MAX_BYTES = 8 * 1024 * 1024

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You must be signed in.' }, { status: 401 })

  const limit = await rateLimit('payment', user.id)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds, 'payment attempts')

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
  // Idempotent: an already-approved payment (a double tap, or a resubmit after it
  // activated) is a success, not an error — the plan is already live.
  if (payment.status === 'approved') {
    return NextResponse.json({ success: true, reference })
  }
  if (payment.status === 'rejected') {
    return NextResponse.json({ error: 'That payment has already been reviewed.' }, { status: 409 })
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

  // Record the transfer details on the row. Not fatal if it matches no rows (a
  // concurrent submit may already have moved it on) — activatePayment below is
  // the source of truth and is idempotent.
  const { error } = await admin
    .from('payments')
    .update({
      // One consistent channel value for every manual transfer (PR31 §2). The
      // member still picks how they paid above (validated), but the stored
      // channel is normalised to 'transfer' so old and new rows read the same.
      method: 'transfer',
      reference: payerReference,
      screenshot_path: screenshotPath,
      updated_at: new Date().toISOString(),
    })
    .eq('id', payment.id)
    .eq('user_id', user.id)
    .eq('status', 'pending')

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Activate now — the SAME function the gateway webhook runs (PR30). It sets the
  // payment approved, creates the subscription (or records the one-time fee),
  // sends the plan/fee notification and receipt, and is idempotent on a replay.
  const result = await activatePayment({ paymentId: payment.id as string, source: 'manual_submit' })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ success: true, reference })
}
