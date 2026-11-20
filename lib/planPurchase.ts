// The member's running paid plan, read for the PR-13 purchase rules
// (lib/planPurchaseCore): /pay/choose, the checkout and receipt routes, and
// lib/payments/activate.ts all ask here, so they decide from the same rows.
//
// Service role: `subscriptions` is self-read under RLS and activation runs
// without a member session. Read-only.

import { createAdminClient } from '@/lib/supabase/admin'
import { planChange, type PlanChange, type RunningPlan } from '@/lib/planPurchaseCore'

/**
 * The highest-ranked ACTIVE, unexpired subscription of the given audience, or
 * null. The same pick getEntitlements makes (highest search_rank wins).
 */
export async function runningPlanFor(
  userId: string,
  audience: 'tutor' | 'parent',
  now = new Date(),
): Promise<(RunningPlan & { subscriptionId: string }) | null> {
  const admin = createAdminClient()
  if (!admin) return null
  const [{ data: subs }, { data: plans }] = await Promise.all([
    admin
      .from('subscriptions')
      .select('id, plan_code, expires_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .gt('expires_at', now.toISOString()),
    admin.from('plans').select('code, audience, search_rank'),
  ])
  const rankOf = new Map(
    ((plans ?? []) as { code: string; audience: string; search_rank: number | null }[])
      .filter((p) => p.audience === audience)
      .map((p) => [p.code, p.search_rank ?? 0]),
  )
  let best: (RunningPlan & { subscriptionId: string }) | null = null
  for (const s of (subs ?? []) as { id: string; plan_code: string; expires_at: string | null }[]) {
    const rank = rankOf.get(s.plan_code)
    if (rank == null) continue
    const later = best && s.plan_code === best.code && (s.expires_at ?? '') > (best.expiresAt ?? '')
    if (!best || rank > best.rank || later) {
      best = { code: s.plan_code, rank, expiresAt: s.expires_at, subscriptionId: s.id }
    }
  }
  return best
}

/** What buying `target` would be for this member right now. */
export async function planChangeFor(
  userId: string,
  audience: 'tutor' | 'parent',
  target: { code: string; rank: number },
): Promise<{ change: PlanChange; running: RunningPlan }> {
  const running = await runningPlanFor(userId, audience)
  return { change: planChange(running, target), running }
}
