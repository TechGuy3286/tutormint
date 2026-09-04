// lib/upsell.ts
//
// One answer to "what higher plan, if any, do we offer this member?", so no
// upsell surface ever pitches the plan they already hold or a lower one.
//
// The ladders are ordered low → high. The next-higher of the held plan is the
// single plan to offer; at the top of the ladder the answer is null and the
// surface renders nothing. A member with NO plan is offered the first rung.
//
// This supersedes lib/upgradePath.ts's nextPlan(), which never returned null
// and could return the held plan (a Featured parent got 'parent_featured', a
// Featured tutor got 'featured').

import type { PlanCode } from '@/lib/entitlements'

export type UpsellAudience = 'tutor' | 'parent'

const LADDER: Record<UpsellAudience, PlanCode[]> = {
  tutor: ['verified', 'premium', 'featured'],
  parent: ['parent_verified', 'parent_featured'],
}

/** The rank of a plan within its ladder (1-based); 0 for no plan / unknown. */
export function planRank(audience: UpsellAudience, plan: string | null | undefined): number {
  if (!plan) return 0
  const i = LADDER[audience].indexOf(plan as PlanCode)
  return i === -1 ? 0 : i + 1
}

/**
 * The single next-higher plan to offer, or null when the member is already at
 * the top of their ladder. A member with no plan gets the first rung.
 */
export function nextUpsell(
  audience: UpsellAudience | null | undefined,
  currentPlan: string | null | undefined,
): PlanCode | null {
  if (!audience) return null
  const ladder = LADDER[audience]
  const rank = planRank(audience, currentPlan)
  return ladder[rank] ?? null // ladder[rank] is the (rank+1)th rung, i.e. the next one up
}
