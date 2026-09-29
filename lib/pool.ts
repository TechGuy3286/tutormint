// lib/pool.ts
//
// The shared monthly pool (PR91 Part B). A tutor's ONE allowance — Basic 10,
// Premium 100, Featured 300 (shown "Unlimited") — is drawn down by BOTH applying
// to a tuition and viewing a tuition's / parent's contact number. The cap is the
// plan's monthly_quota (ent.quota); the counter is usage_counters.jobs_applied,
// so ent.quotaLeft already reports the pool remaining.
//
// ONCE PER TUITION / PER PARENT. Viewing then applying (or the reverse) uses 1 in
// total; a second view is free. The dedup and the atomic cap check live in the
// SQL functions spend_tuition_pool / spend_parent_pool (migration 123, the PR56
// lock pattern), so two taps or a concurrent apply+view can never overspend.
//
// PRE-MIGRATION SAFETY. The functions are additive and applied after this code
// deploys. Until they exist, the RPC errors and this returns 'unavailable'; the
// caller then falls back to the old per-counter path (apply: checkQuota/
// consumeQuota; reveal: the old reveal RPCs) so nothing breaks in the window.

import { createAdminClient } from '@/lib/supabase/admin'
import { currentPeriod, type Entitlements } from '@/lib/entitlements'
import { tutorApplyOffer, upgradeHref } from '@/lib/upgradePath'
import { buildGate, type Gate } from '@/lib/gate'

export type PoolSpend =
  /** Allowed. `already` = a prior spend on this tuition/parent covered it (free). */
  | { ok: true; already: boolean; used: number }
  /** Over the monthly cap — the pool is empty. */
  | { ok: false; reason: 'exhausted'; used: number }
  /** The pool function is not available yet (pre-migration) or errored. The
   *  caller decides whether to fall back (apply) or fail open (reveal). */
  | { ok: false; reason: 'unavailable' }

async function spend(
  fn: 'spend_tuition_pool' | 'spend_parent_pool',
  args: Record<string, unknown>,
  cap: number,
): Promise<PoolSpend> {
  const admin = createAdminClient()
  if (!admin) return { ok: false, reason: 'unavailable' }
  try {
    const { data, error } = await admin.rpc(fn, { ...args, p_cap: cap, p_period: currentPeriod() })
    if (error) throw error
    const row = Array.isArray(data) ? data[0] : data
    const used = (row?.used as number | null) ?? 0
    if (row?.allowed) return { ok: true, already: !!row?.already, used }
    return { ok: false, reason: 'exhausted', used }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/** Spend one pool unit on a TUITION (apply or contact view). */
export function spendTuitionPool(tutorId: string, jobId: string, cap: number): Promise<PoolSpend> {
  return spend('spend_tuition_pool', { p_tutor: tutorId, p_job: jobId }, cap)
}

/** Spend one pool unit on a PARENT account reveal. */
export function spendParentPool(tutorId: string, parentId: string, cap: number): Promise<PoolSpend> {
  return spend('spend_parent_pool', { p_tutor: tutorId, p_parent: parentId }, cap)
}

/**
 * The refusal when the shared pool is empty (PR91 Part B.4), used by BOTH apply
 * and contact-view so the wording and the offer are identical. Offers the next
 * plan up — Basic → Premium, Premium → Featured — and, for a Featured tutor at
 * the cap, an offer of `null` so the gate just says "resets next month" and waits.
 */
export async function poolExhaustedFail(
  ent: Entitlements,
  tutorId: string,
): Promise<{ status: number; error: string; upgrade: string; gate: Gate }> {
  let hadPaidPlanBefore = false
  const admin = createAdminClient()
  if (ent.plan === 'basic' && admin) {
    const { data: prior } = await admin
      .from('subscriptions')
      .select('plan_code')
      .eq('user_id', tutorId)
      .in('plan_code', ['premium', 'featured'])
      .limit(1)
      .maybeSingle()
    hadPaidPlanBefore = !!prior
  }
  const offered = tutorApplyOffer(ent.plan, hadPaidPlanBefore)
  return {
    status: 403,
    error: `You have used all ${ent.quota} of this month's allowance.`,
    upgrade: upgradeHref('tutor', ent.plan),
    gate: await buildGate('tutor_apply_quota', ent, offered),
  }
}
