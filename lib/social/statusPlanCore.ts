// lib/social/statusPlanCore.ts — PURE, client-safe.
//
// The plan badge a tutor's status image (and social post / link preview pills)
// shows (owner, 10 Nov 2026): the HIGHEST plan the tutor holds right now —
// Featured, then Premium, then Verified. An upgrade counts only while it is
// active and before its end date (lib/upgradePlanCore pickUpgrade — the same
// rule the People card's "Featured · ends 9 Dec" line reads, dates shown in
// Pakistan time). Once it ends, a new download falls back to Verified by itself.
//
// Unit-tested by scripts/test-status-plan.ts.

import { pickUpgrade } from '@/lib/upgradePlanCore'

export type StatusPlan = 'verified' | 'premium' | 'featured'

type SubRow = { plan_code: string | null; status: string | null; expires_at: string | null }

/** The plan the image shows, from the tutor's subscriptions at `nowMs`. */
export function statusPlanFor(subs: SubRow[], nowMs: number): StatusPlan {
  return pickUpgrade(subs, nowMs)?.code ?? 'verified'
}

/** The label drawn beside the name. */
export const STATUS_PLAN_LABEL: Record<StatusPlan, string> = {
  verified: 'Verified tutor',
  premium: 'Premium tutor',
  featured: 'Featured tutor',
}

/** The coloured words of the headline: "I'm a <accent>". */
export const STATUS_PLAN_HEADLINE_ACCENT: Record<StatusPlan, string> = {
  verified: 'Verified Tutor',
  premium: 'Premium Tutor',
  featured: 'Featured Tutor',
}

/** The glyph on the photo ring: ✓ tick, lightning bolt or crown. */
export const STATUS_PLAN_GLYPH: Record<StatusPlan, 'tick' | 'bolt' | 'crown'> = {
  verified: 'tick',
  premium: 'bolt',
  featured: 'crown',
}

/** The badge row a social post or preview draws: Verified, then the upgrade. */
export function planBadgeNames(plan: StatusPlan): ('Verified' | 'Premium' | 'Featured')[] {
  if (plan === 'featured') return ['Verified', 'Premium', 'Featured']
  if (plan === 'premium') return ['Verified', 'Premium']
  return ['Verified']
}

/** The downloaded file's name. */
export function statusPlanFileWord(plan: StatusPlan): string {
  return plan === 'featured' ? 'Featured' : plan === 'premium' ? 'Premium' : 'Verified'
}
