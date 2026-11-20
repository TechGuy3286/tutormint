// Buying a monthly plan (Premium, Featured, parent Featured) — PR-13, 21 Nov 2026.
//
// One set of rules, read by the Membership Plans card, /pay/choose, the two
// payment routes and lib/payments/activate.ts, so what the button offers, what
// the server accepts and what approval grants cannot disagree:
//
//   • new       — no paid plan running: 30 days from approval.
//   • upgrade   — a lower paid plan is running (Premium → Featured): the old
//                 one is replaced and the new one runs a fresh 30 days from
//                 approval. No proration (Membership Plans says so).
//   • extend    — the SAME plan is running: 30 more days from its current end.
//   • downgrade — a higher paid plan is running: never offered, refused.
//
// "Running" means a paid subscription (active, end date in the future). The
// free tiers (tutor Basic after the fee, parent Verified) have no end date and
// are not a running plan here.
//
// Pure: no I/O, so client components and the test runner can import it.

export type PlanChange = 'new' | 'upgrade' | 'extend' | 'downgrade'

/** The paid plan the member is on now, or null. */
export type RunningPlan = { code: string; rank: number; expiresAt: string | null } | null

export function planChange(current: RunningPlan, target: { code: string; rank: number }): PlanChange {
  if (!current || !current.expiresAt) return 'new'
  if (current.code === target.code) return 'extend'
  return target.rank > current.rank ? 'upgrade' : 'downgrade'
}

/** The refusal for a purchase that is a downgrade, or null. */
export const DOWNGRADE_REFUSED = 'You already have a higher plan. It stays until its end date.'

export function downgradeRefusal(change: PlanChange): { error: string; code: 'downgrade'; status: 409 } | null {
  return change === 'downgrade' ? { error: DOWNGRADE_REFUSED, code: 'downgrade', status: 409 } : null
}

/**
 * The start and end of the plan an approval creates. An extension runs on from
 * the current end date (never from before now); everything else starts now.
 */
export function planWindow(
  now: Date,
  days: number,
  change: PlanChange,
  currentExpiresAt: string | null,
): { startsAt: Date; expiresAt: Date } {
  const d = days > 0 ? days : 30
  if (change === 'extend' && currentExpiresAt) {
    const end = new Date(currentExpiresAt)
    const from = end.getTime() > now.getTime() ? end : now
    return { startsAt: now, expiresAt: new Date(from.getTime() + d * 86_400_000) }
  }
  return { startsAt: now, expiresAt: new Date(now.getTime() + d * 86_400_000) }
}

/** What a paid card on Membership Plans shows in its button area. */
export type BuyButtonState =
  | 'coming_soon' // paused plan — disabled "Coming soon"
  | 'sign_in' // signed out — "Upgrade to X", goes to sign-in, then back here
  | 'other_audience' // a parent on the Tutors tab, or a tutor on the Parents tab
  | 'pay_fee_first' // a tutor who has not paid the Verification Fee
  | 'upgrade' // "Upgrade to X" → the payment page
  | 'extend' // the plan they hold → "Extend 30 days"
  | 'lower' // below the plan they hold — no button (no downgrades)

export function buyButtonState(f: {
  signedIn: boolean
  /** The viewer's own audience (null for a staff account or an unknown role). */
  viewerAudience: 'tutor' | 'parent' | null
  cardAudience: 'tutor' | 'parent'
  /** Tutor only: the one-time Verification Fee is paid. */
  feePaid: boolean
  /** The paid plan the viewer is on now (same audience), or null. */
  current: RunningPlan
  plan: { code: string; rank: number }
  /** upgradeBlocked() for this plan. */
  blocked: boolean
}): BuyButtonState {
  if (f.blocked) return 'coming_soon'
  if (!f.signedIn) return 'sign_in'
  if (f.viewerAudience !== f.cardAudience) return 'other_audience'
  if (f.cardAudience === 'tutor' && !f.feePaid) return 'pay_fee_first'
  const change = planChange(f.current, f.plan)
  if (change === 'extend') return 'extend'
  if (change === 'downgrade') return 'lower'
  return 'upgrade'
}

/** The button's words. Never a price (prices are on the card and /pay/choose). */
export function buyButtonLabel(state: BuyButtonState, planName: string): string {
  if (state === 'extend') return 'Extend 30 days'
  return `Upgrade to ${planName}`
}

/** Where a signed-out visitor goes: sign in, then back to this plan's card. */
export function signInThenPlanHref(cardAudience: 'tutor' | 'parent', planCode: string): string {
  const back = `/membership-plans?for=${cardAudience === 'tutor' ? 'tutors' : 'parents'}&plan=${encodeURIComponent(planCode)}`
  return `/login?next=${encodeURIComponent(back)}`
}

/** The note under the button for a tutor who must pay the fee first. */
export const FEE_FIRST_NOTE = 'Pay the one-time Verification Fee first.'
