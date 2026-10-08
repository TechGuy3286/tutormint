import { NextResponse } from 'next/server'
import { drainIndexingQueue, INDEXING_DAILY_LIMIT } from '@/lib/googleIndexing'
import { timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { pproConfigured, markPayproOrderBlocked } from '@/lib/payments/paypro'
import { confirmPayproOrder } from '@/lib/payments/payproReconcile'
import { publishDuePosts } from '@/lib/blogPublish'

// Backup reconcile (PR65 §5). PayPro's "Mark as Paid" callback can be missed, so
// this re-checks pending PayPro orders via the ONE confirm path (PR104:
// confirmPayproOrder → ggos → the amount rule that allows a gateway fee on top →
// activate). Idempotent, so running it every 5 min is safe.
//
// It also tidies DUPLICATES: a pending PayPro order whose (member, plan) already
// has an APPROVED payment can never be paid again, so it is blocked at PayPro
// (ppro/moab) and its row set to 'rejected' — the superseded-order case (PR104 §3).
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
  // Scheduled blog posts go live within five minutes (owner, 5 Oct 2026): this
  // is the only frequent cron, so it also runs the due-post sweep, independent
  // of PayPro being configured. The daily cron keeps its own call as a backstop.
  const blog = await publishDuePosts().catch((e: unknown) => ({ published: 0, slugs: [], errors: [e instanceof Error ? e.message : 'failed'] }))
  // Google Indexing API notices (owner, 8 Oct 2026): drained here, a few at a
  // time, never past 200 in a UTC day; anything over waits for the next day.
  const indexing = await drainIndexingQueue(INDEXING_DAILY_LIMIT, 20_000).catch(() => ({ sent: 0, failed: 0, left: -1 }))
  if (!pproConfigured()) return NextResponse.json({ ok: true, skipped: 'paypro_not_configured', blog, indexing })

  const admin = createAdminClient()
  if (!admin) return NextResponse.json({ ok: true, skipped: 'no_admin_client' })

  // Pending PayPro orders from the last 2 days (older ones have expired). An
  // optional ?days=N (bounded 1–60) widens the window for a one-off sweep.
  const daysParam = Number(new URL(request.url).searchParams.get('days'))
  const days = Number.isFinite(daysParam) ? Math.min(Math.max(Math.floor(daysParam), 1), 60) : 2
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { data: rows } = await admin
    .from('payments')
    .select('id, user_id, plan_code, amount_pkr, status, provider_ref, raw, created_at')
    .eq('provider', 'paypro')
    .eq('status', 'pending')
    .gte('created_at', since)
    .limit(100)

  let checked = 0
  let activated = 0
  let notPaid = 0
  let blocked = 0
  const diag: Record<string, unknown>[] = []
  for (const row of rows ?? []) {
    checked++
    try {
      const r = await confirmPayproOrder({
        id: row.id as string,
        amount_pkr: row.amount_pkr as number,
        status: row.status as string,
        provider_ref: row.provider_ref as string,
        raw: row.raw,
      })
      // Amounts/status/reason only — never a secret — for ops to see WHY a paid
      // order was or was not accepted.
      diag.push({
        ref: row.provider_ref,
        activated: r.activated,
        accepted: r.accepted,
        reason: r.reason ?? null,
        ggosError: r.ggosError ?? null,
        orderStatus: r.orderStatus ?? null,
        amountPayable: r.amountPayable ?? null,
        amountPaid: r.amountPaid ?? null,
        ours: row.amount_pkr,
      })
      if (r.activated) {
        activated++
        continue
      }
      if (r.accepted) continue // already active

      // Not paid (or rejected amount). If the member ALREADY has an approved
      // payment for this same plan, this pending order is a superseded duplicate
      // they could pay by mistake — block it at PayPro and mark it rejected.
      const { data: paidSibling } = await admin
        .from('payments')
        .select('id')
        .eq('user_id', row.user_id as string)
        .eq('plan_code', row.plan_code as string)
        .eq('status', 'approved')
        .limit(1)
        .maybeSingle()
      if (paidSibling) {
        await markPayproOrderBlocked(row.provider_ref as string)
        await admin
          .from('payments')
          .update({
            status: 'rejected',
            rejection_reason: 'Duplicate order — superseded by a completed payment.',
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id as string)
          .eq('status', 'pending')
        blocked++
      } else {
        notPaid++
      }
    } catch {
      /* skip this row; the next run retries */
    }
  }

  return NextResponse.json({ ok: true, checked, activated, notPaid, blocked, diag })
}
