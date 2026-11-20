import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordLatePayproNotice } from '@/lib/payments/payproReconcile'
import { recordGatewayEvent } from '@/lib/payments/gatewaySettings'

// PayPro callback — POST https://www.tutormint.org/paypro/uis
//
// PayPro has ENDED (owner, 20 Nov 2026 — PR-12). The address stays so a late
// callback is answered safely: it is LOGGED (Payment gateways health) and
// IGNORED — nobody is activated and no payments row changes. It reads no PayPro
// setting, so it keeps working after the PAYPRO_* variables are deleted.
//
// Because we can no longer check the sender's username/password or confirm the
// order with PayPro, a "paid" notice for one of OUR pending PayPro orders only
// puts one line in Finance → Needs attention (de-duplicated per order) for the
// Owner to check the PayPro portal. Unknown order ids get PayPro's "no record".
// It never throws and never echoes anything the caller sent beyond the id.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Reply = { StatusCode: string; InvoiceID: string | null; Description: string }

const MAX_IDS = 20

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    /* not JSON — answered below as "no records" */
  }

  const csv = typeof body.csvinvoiceids === 'string' ? body.csvinvoiceids : ''
  const ids = [...new Set(csv.split(',').map((s) => s.trim()).filter((s) => s && s.length <= 80))].slice(0, MAX_IDS)
  await recordGatewayEvent('paypro', 'callback', `A PayPro callback arrived after PayPro ended (${ids.length} order${ids.length === 1 ? '' : 's'}). Ignored — nobody activated.`)
  console.warn(`[paypro] late callback ignored orders=${ids.length}`)

  if (ids.length === 0) return NextResponse.json([{ StatusCode: '03', InvoiceID: null, Description: 'No records found.' }])

  const replies: Reply[] = []
  const admin = createAdminClient()
  for (const id of ids) {
    try {
      const { data: row } = admin
        ? await admin.from('payments').select('id, amount_pkr, status, provider_ref, raw').eq('provider', 'paypro').eq('provider_ref', id).maybeSingle()
        : { data: null }
      if (!row) {
        replies.push({ StatusCode: '03', InvoiceID: id, Description: 'No records found.' })
        continue
      }
      await recordLatePayproNotice({
        id: row.id as string,
        amount_pkr: row.amount_pkr as number,
        status: row.status as string,
        provider_ref: row.provider_ref as string,
        raw: row.raw,
      })
      // Told "received" so PayPro stops retrying; nothing was activated.
      replies.push({ StatusCode: '00', InvoiceID: id, Description: 'Received' })
    } catch {
      replies.push({ StatusCode: '02', InvoiceID: id, Description: 'Service Failure' })
    }
  }
  return NextResponse.json(replies)
}
