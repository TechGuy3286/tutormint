import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPayproOrderStatus, payProIdFromRow, pproConfigured } from '@/lib/payments/paypro'
import { activatePayment } from '@/lib/payments/activate'

// Backup reconcile (PR65 §5). PayPro's "Mark as Paid" callback can be missed, so
// this re-checks pending PayPro orders via ggos and activates any that PayPro now
// says are PAID (amount matching). Idempotent — activatePayment does nothing for
// an already-activated payment — so running it often is safe.
//
// Protected by CRON_SECRET (the subscriptions-cron pattern): refuses every
// request when the secret is unset, and compares in constant time. GET, because
// that is what Vercel Cron issues.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : header
  const a = Buffer.from(secret, 'utf8')
  const b = Buffer.from(provided, 'utf8')
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!pproConfigured()) return NextResponse.json({ ok: true, skipped: 'paypro_not_configured' })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ ok: true, skipped: 'no_admin_client' })

  // Pending PayPro orders from the last 2 days (older ones have expired).
  const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
  const { data: rows } = await admin
    .from('payments')
    .select('id, amount_pkr, status, raw, created_at')
    .eq('provider', 'paypro')
    .eq('status', 'pending')
    .gte('created_at', since)
    .limit(100)

  let checked = 0
  let activated = 0
  let mismatched = 0
  for (const row of rows ?? []) {
    checked++
    try {
      const payProId = payProIdFromRow(row)
      const status = await getPayproOrderStatus(payProId)
      if (!status.ok || status.orderStatus !== 'PAID') continue
      if (Math.abs(status.amountPaid - Number(row.amount_pkr)) >= 1) {
        mismatched++ // paid a different amount than our price — leave for a human
        continue
      }
      const result = await activatePayment({ paymentId: row.id as string, source: 'gateway' })
      if (result.ok) activated++
    } catch {
      /* skip this row; the next run retries */
    }
  }

  return NextResponse.json({ ok: true, checked, activated, mismatched })
}
