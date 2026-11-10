// lib/upgradePlanCore.ts
//
// PURE, client-safe. The plan a PAID tutor holds (owner, 10 Nov 2026): the
// free Verified tier (the Verification Fee only), or a Premium / Featured
// upgrade until its end date. People → Paid filters by it, the card shows
// "Premium · ends 8 Dec", and the Overview row "Upgrades ending in 7 days"
// counts the upgrades whose end date is within 7 days. An upgrade stays active
// until its end date — nothing here changes it early.
//
// Unit-tested by scripts/test-pr2-nov10.ts.

export type UpgradeCode = 'premium' | 'featured'
export type UpgradeHeld = { code: UpgradeCode; endsAt: string }
export type PaidPlanTag = 'verified' | UpgradeCode

export const PLAN_FILTER: { key: 'all' | PaidPlanTag; label: string }[] = [
  { key: 'all', label: 'All paid' },
  { key: 'verified', label: 'Verified' },
  { key: 'premium', label: 'Premium' },
  { key: 'featured', label: 'Featured' },
]

export const UPGRADE_ENDING_DAYS = 7
const DAY = 86_400_000
const NAME: Record<UpgradeCode, string> = { premium: 'Premium', featured: 'Featured' }

type SubRow = { plan_code: string | null; status: string | null; expires_at: string | null }

/** The upgrade a member holds now: an ACTIVE Premium or Featured subscription
 *  that has not ended. Featured wins over Premium; then the later end date. */
export function pickUpgrade(subs: SubRow[], nowMs: number): UpgradeHeld | null {
  let best: UpgradeHeld | null = null
  for (const s of subs) {
    const code = s.plan_code
    if (s.status !== 'active' || (code !== 'premium' && code !== 'featured')) continue
    const end = Date.parse(s.expires_at ?? '')
    if (!Number.isFinite(end) || end <= nowMs) continue
    const cand: UpgradeHeld = { code, endsAt: new Date(end).toISOString() }
    if (!best) best = cand
    else if (cand.code === 'featured' && best.code === 'premium') best = cand
    else if (cand.code === best.code && end > Date.parse(best.endsAt)) best = cand
  }
  return best
}

/** The stored filter tag: a paid tutor's plan, 'na' for anyone else. */
export function planTag(stage: string, plan: UpgradeHeld | null | undefined): PaidPlanTag | 'na' {
  if (stage !== 'paid') return 'na'
  return plan?.code ?? 'verified'
}

/** "8 Dec" — the day and short month in Pakistan time. */
export function shortDay(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Karachi' }).format(new Date(iso))
}

/** "Premium · ends 8 Dec" for an upgraded card; null for Verified. */
export function planEndsLine(plan: UpgradeHeld | null | undefined): string | null {
  return plan ? `${NAME[plan.code]} · ends ${shortDay(plan.endsAt)}` : null
}

/** The upgrade ends within `days` days from now (and has not ended). */
export function upgradeEndingSoon(plan: UpgradeHeld | null | undefined, nowMs: number, days = UPGRADE_ENDING_DAYS): boolean {
  if (!plan) return false
  const end = Date.parse(plan.endsAt)
  return Number.isFinite(end) && end > nowMs && end - nowMs <= days * DAY
}

/** The Plan row's counts over paid tutors' tags. */
export function planCounts(tags: (PaidPlanTag | 'na')[]): Record<'all' | PaidPlanTag, number> {
  const out = { all: 0, verified: 0, premium: 0, featured: 0 }
  for (const t of tags) {
    if (t === 'na') continue
    out.all++
    out[t]++
  }
  return out
}
