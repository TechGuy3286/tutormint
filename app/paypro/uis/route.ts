import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { confirmPayproOrder } from '@/lib/payments/payproReconcile'
import { recordGatewayEvent } from '@/lib/payments/gatewaySettings'

// PayPro callback (PR65) — POST https://www.tutormint.org/paypro/uis
//
// PUBLIC by design: PayPro calls it server-to-server, so it is NOT behind auth
// and never redirects. It authenticates by the username/password PayPro sends in
// the body (compared to PAYPRO_CALLBACK_*), and it NEVER activates on the
// callback alone — PayPro's "Mark as Paid" cannot be disabled, so every order is
// re-confirmed with Get Order Status (ggos) and activated only when PayPro says
// PAID and the amount paid equals our price. Activation is idempotent
// (activatePayment), so a repeated callback never double-activates.
//
// Response is PayPro's array format (docs/paypro/…callback…pdf): one object per
// invoice id — "00" paid, "01" bad credentials, "02" internal error/unconfirmed,
// "03" no record.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Reply = { StatusCode: string; InvoiceID: string | null; Description: string }

const BAD_CREDS: Reply[] = [
  { StatusCode: '01', InvoiceID: null, Description: 'Invalid Data. Username or password is invalid' },
]

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  try {
    return timingSafeEqual(ab, bb)
  } catch {
    return false
  }
}

function credentialsOk(username: unknown, password: unknown): boolean {
  const u = process.env.PAYPRO_CALLBACK_USERNAME ?? ''
  const p = process.env.PAYPRO_CALLBACK_PASSWORD ?? ''
  if (!u || !p) return false // never accept when our side is unconfigured
  if (typeof username !== 'string' || typeof password !== 'string') return false
  if (!username || !password) return false
  // Evaluate both to keep the timing independent of which one is wrong.
  const okU = constantTimeEqual(username, u)
  const okP = constantTimeEqual(password, p)
  return okU && okP
}

async function processOrder(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  orderId: string,
): Promise<Reply> {
  const id = orderId.trim()
  if (!id) return { StatusCode: '03', InvoiceID: orderId, Description: 'No records found.' }

  const { data: row } = await admin
    .from('payments')
    .select('id, amount_pkr, status, provider_ref, raw')
    .eq('provider', 'paypro')
    .eq('provider_ref', id)
    .maybeSingle()

  if (!row) return { StatusCode: '03', InvoiceID: id, Description: 'No records found.' }

  // One shared confirm+activate path (PR104): ggos, the amount rule
  // (lib/payproVerify — a gateway fee on top of our price is fine), record the
  // paid details, activate. Idempotent for an already-approved row.
  const r = await confirmPayproOrder({
    id: row.id as string,
    amount_pkr: row.amount_pkr as number,
    status: row.status as string,
    provider_ref: row.provider_ref as string,
    raw: row.raw,
  })
  if (r.activated || r.alreadyActive) {
    return { StatusCode: '00', InvoiceID: id, Description: 'Invoice successfully marked as paid' }
  }
  return { StatusCode: '02', InvoiceID: id, Description: 'Service Failure' }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json(BAD_CREDS)
  }

  if (!credentialsOk(body.username, body.password)) {
    // Health (item 19): a callback with the wrong username/password is an error.
    await recordGatewayEvent('paypro', 'error', 'A PayPro callback arrived with the wrong username or password.')
    return NextResponse.json(BAD_CREDS)
  }
  // Health (item 19): "last callback received".
  await recordGatewayEvent('paypro', 'callback')

  const admin = createAdminClient()
  if (!admin) {
    return NextResponse.json([{ StatusCode: '02', InvoiceID: null, Description: 'Service Failure' }])
  }

  const csv = typeof body.csvinvoiceids === 'string' ? body.csvinvoiceids : ''
  const ids = csv.split(',').map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) {
    return NextResponse.json([{ StatusCode: '03', InvoiceID: null, Description: 'No records found.' }])
  }

  const replies: Reply[] = []
  for (const id of ids) {
    try {
      replies.push(await processOrder(admin, id))
    } catch {
      replies.push({ StatusCode: '02', InvoiceID: id, Description: 'Service Failure' })
    }
  }
  return NextResponse.json(replies)
}
