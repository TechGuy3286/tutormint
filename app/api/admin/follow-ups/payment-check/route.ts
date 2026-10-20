import { NextResponse } from 'next/server'

import { checkAdminRole } from '@/lib/adminAuth'
import { createAdminClient } from '@/lib/supabase/admin'
import { confirmPayproOrder } from '@/lib/payments/payproReconcile'
import { logAdminAction } from '@/lib/auditLog'
import { paymentCheckOutcome } from '@/lib/tutorFollowUpCore'
import { formatDateTime } from '@/lib/datetime'
import { parseBody, z, uuid } from '@/lib/validate'

// POST /api/admin/follow-ups/payment-check { paymentId } (owner, 20 Oct 2026)
// — "Check payment status" on a Started payment card. Asks PayPro for that
// order's real status (ggos) through confirmPayproOrder — THE same path the
// PayPro callback, the return page and the reconcile cron use — so a paid
// order activates exactly as a normal confirmation would, and nothing here
// writes a payment's status itself. The Owner and the Partner only: the roles
// that see payment amounts (checkAdminRole('partner') admits the Owner too).
// No key, token, phone or email is ever logged or returned.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({ paymentId: uuid })

export async function POST(request: Request) {
  const gate = await checkAdminRole('partner')
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const parsed = await parseBody(request, Body)
  if (!parsed.ok) return parsed.response

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ error: 'This is not working right now. Please try again in a few minutes.' }, { status: 503 })
  const { data: row } = await admin
    .from('payments')
    .select('id, user_id, amount_pkr, status, provider, provider_ref, raw, paypro_id')
    .eq('id', parsed.data.paymentId)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'That payment was not found.' }, { status: 404 })
  if (row.provider !== 'paypro') return NextResponse.json({ error: 'Only PayPro orders can be checked here.' }, { status: 400 })

  const result = await confirmPayproOrder({
    id: row.id as string,
    amount_pkr: Number(row.amount_pkr),
    status: row.status as string,
    provider_ref: row.provider_ref as string,
    raw: row.raw,
    paypro_id: (row.paypro_id as string | null) ?? null,
  })
  const checkedAt = new Date().toISOString()
  const outcome = paymentCheckOutcome(result, formatDateTime(checkedAt))

  await logAdminAction({
    actorId: gate.actor.id,
    actorRole: gate.actor.adminRole,
    actorEmail: gate.actor.email ?? null,
    action: 'payment.status_check',
    targetType: 'payment',
    targetId: row.id as string,
    detail: {
      orderRef: row.provider_ref,
      memberId: row.user_id,
      outcome: outcome.state,
      activated: result.activated,
      alreadyActive: result.alreadyActive,
      orderStatus: result.orderStatus ?? null,
      reason: result.reason ?? null,
    },
  })

  return NextResponse.json({ state: outcome.state, message: outcome.message, checkedAt })
}
