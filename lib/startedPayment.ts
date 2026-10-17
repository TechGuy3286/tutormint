// lib/startedPayment.ts — the I/O half of "Started payment, didn't finish"
// (owner, 16 Oct 2026). The rules are in lib/startedPaymentCore. One loader for
// the Overview to-do row, its list page and the Follow-ups → Tutors chip, so
// the count and the lists cannot disagree.

import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { pageAll, pageAllIn } from '@/lib/pageAll'
import {
  STARTED_PAYMENT_CLEAR_MS,
  startedNotFinished,
  type MemberPaid,
  type StartedCheckout,
} from '@/lib/startedPaymentCore'

export type StartedRow = StartedCheckout & { providerRef: string | null }

/** Every checkout that is started-and-not-finished now, newest first. */
export async function loadStartedNotFinished(now = new Date()): Promise<StartedRow[]> {
  const admin = createAdminClient()
  if (!admin) return []
  const since = new Date(now.getTime() - STARTED_PAYMENT_CLEAR_MS - 60_000).toISOString()
  const pending = await pageAll((from, to) =>
    admin
      .from('payments')
      .select('id, user_id, plan_code, status, created_at, provider, provider_ref, screenshot_path, reference')
      .eq('status', 'pending')
      // A checkout the member cancelled (or the clean-up closed) is not chased (17 Oct 2026).
      .is('checkout_closed_at', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to),
  )
  const rows: StartedRow[] = pending.map((p) => ({
    id: p.id as string,
    userId: (p.user_id as string | null) ?? null,
    planCode: (p.plan_code as string | null) ?? null,
    status: p.status as string,
    createdAt: p.created_at as string,
    provider: (p.provider as string | null) ?? null,
    providerRef: (p.provider_ref as string | null) ?? null,
    hasReceipt: !!(p.screenshot_path as string | null) || !!((p.reference as string | null) ?? '').trim(),
  }))
  const userIds = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))]
  const paidBy = new Map<string, MemberPaid>()
  if (userIds.length > 0) {
    const [approved, tps] = await Promise.all([
      pageAllIn(userIds, (part, from, to) =>
        admin
          .from('payments')
          .select('id, user_id, plan_code, created_at, reviewed_at, refunded_at')
          .eq('status', 'approved')
          .in('user_id', part)
          .order('id')
          .range(from, to),
      ),
      pageAllIn(userIds, (part, from, to) =>
        admin.from('tutor_profiles').select('id, verified_fee_paid_at').in('id', part).order('id').range(from, to),
      ),
    ])
    for (const id of userIds) paidBy.set(id, { approved: [] })
    for (const a of approved) {
      if (a.refunded_at) continue
      paidBy.get(a.user_id as string)?.approved.push({
        planCode: a.plan_code as string,
        at: ((a.reviewed_at as string | null) ?? (a.created_at as string)) as string,
      })
    }
    for (const t of tps) {
      const m = paidBy.get(t.id as string)
      if (m) m.feePaid = !!t.verified_fee_paid_at
    }
  }
  return startedNotFinished(rows, paidBy, now.getTime()) as StartedRow[]
}
