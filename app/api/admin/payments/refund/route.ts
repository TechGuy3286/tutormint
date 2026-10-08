import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkAdminRole, SCREEN_ACCESS } from '@/lib/adminAuth'
import { requireFreshAuth } from '@/lib/reauth'
import { recordRefund } from '@/lib/payments/refund'
import { REFUND_METHODS, REFUND_REASONS, type RefundMethod } from '@/lib/payments/refundCore'

// Record a refund against an approved payment (PR106-H4 §4). Owner only
// (SCREEN_ACCESS.paymentsRefund — owner only since 8 Oct 2026; was the same as approving a
// transfer), and a fresh password, because it moves money. Accepts multipart so
// an optional proof screenshot can ride along; it is stored in the PRIVATE
// payment-proofs bucket and never exposed. The amount, method, reference and
// reason are plain fields — no card details.

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const gate = await checkAdminRole(...SCREEN_ACCESS.paymentsRefund)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const fresh = await requireFreshAuth(gate.actor.id)
  if (!fresh.ok) return fresh.response

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const paymentId = String(form.get('paymentId') ?? '').trim()
  if (!paymentId) return NextResponse.json({ error: 'Which payment?' }, { status: 400 })
  const method = String(form.get('method') ?? '') as RefundMethod
  if (!REFUND_METHODS.includes(method)) return NextResponse.json({ error: 'Choose a refund method.' }, { status: 400 })
  const reason = String(form.get('reason') ?? '').trim()
  if (!REFUND_REASONS.includes(reason as (typeof REFUND_REASONS)[number]) && reason.length < 3) {
    return NextResponse.json({ error: 'Choose or write a reason.' }, { status: 400 })
  }
  const reference = String(form.get('reference') ?? '').trim()
  const amountRaw = String(form.get('amount') ?? '').trim()
  const amountPkr = amountRaw ? Number(amountRaw.replace(/[^\d]/g, '')) : null

  // Optional proof screenshot → private payment-proofs bucket.
  let proofPath: string | null = null
  const file = form.get('proof')
  if (file && typeof file === 'object' && 'arrayBuffer' in file) {
    const f = file as File
    if (f.size > 0) {
      if (f.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'The screenshot must be under 5 MB.' }, { status: 400 })
      const admin = createAdminClient()
      if (admin) {
        const ext = (f.type.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '')
        const path = `refunds/${paymentId}-${Date.now()}.${ext}`
        const buf = Buffer.from(await f.arrayBuffer())
        const { error } = await admin.storage.from('payment-proofs').upload(path, buf, { contentType: f.type || 'image/jpeg', upsert: false })
        if (!error) proofPath = path
      }
    }
  }

  const result = await recordRefund({
    paymentId,
    amountPkr,
    method,
    reference,
    reason,
    proofPath,
    actor: { id: gate.actor.id, adminRole: gate.actor.adminRole, email: gate.actor.email },
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, amount: result.amount })
}
