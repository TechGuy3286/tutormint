import { NextResponse } from 'next/server'
import { getAdminActor } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  pproAuthHealth,
  pproConfigured,
  pproSandbox,
  createPayproOrder,
  payproOrderNumber,
  markPayproOrderBlocked,
} from '@/lib/payments/paypro'

// Owner-only PayPro live readiness check (PR98 §1).
//
// Read-only in the sense that it creates NO payments row and activates nothing:
// it authenticates with PayPro, creates ONE Rs 199 order for a PAYPRO_TEST_EMAILS
// tutor account (left UNPAID), reports PayPro's response codes, then blocks
// (cancels/expires) that order via ppro/moab so nothing is left outstanding.
//
// It never returns a token, password, secret or the raw Click2Pay URL — only
// whether each thing was present, plus PayPro's status codes/descriptions.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const actor = await getAdminActor()
  if (!actor || actor.adminRole !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const health = await pproAuthHealth() // { ok, error?, sandbox, host }
  const base = { host: health.host, sandbox: pproSandbox(), configured: pproConfigured(), authOk: health.ok }
  if (!health.ok) {
    return NextResponse.json({ ...base, step: 'auth', authError: health.error ?? 'auth_failed' })
  }

  // Pick a test-email tutor account to name as the customer (PAYPRO_TEST_EMAILS,
  // first entry), falling back to the owner's own email. No account mutation.
  const testEmail =
    (process.env.PAYPRO_TEST_EMAILS ?? '').split(',').map((e) => e.trim()).filter(Boolean)[0] ??
    (actor.email ?? '')
  let customerName = 'TutorMint Test'
  const admin = createAdminClient()
  if (admin && testEmail) {
    const { data: who } = await admin
      .from('profiles')
      .select('full_name')
      .ilike('email', testEmail)
      .maybeSingle()
    if (who?.full_name) customerName = who.full_name as string
  }

  const orderNumber = payproOrderNumber()
  const order = await createPayproOrder({
    orderNumber,
    amountPkr: 199,
    customerName,
    customerMobile: '',
    customerEmail: testEmail,
    customerAddress: '',
  })

  if (!order.ok) {
    return NextResponse.json({ ...base, step: 'create', orderNumber, createOk: false, createError: order.error })
  }

  // Tidy up: block the unpaid test order so nothing is left outstanding.
  const blocked = await markPayproOrderBlocked(orderNumber)

  return NextResponse.json({
    ...base,
    step: 'done',
    orderNumber,
    createOk: true,
    payProIdPresent: !!order.payProId,
    click2payPresent: !!order.click2pay,
    isFeeApplied: order.isFeeApplied,
    orderAmount: order.orderAmount,
    testEmailUsed: !!testEmail,
    blocked: { ok: blocked.ok, status: blocked.status ?? null, description: blocked.description ?? null },
  })
}
