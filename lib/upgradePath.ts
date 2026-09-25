// lib/upgradePath.ts
//
// Where an upgrade prompt should send someone, and which card to highlight.
//
// Pure and client-safe on purpose: the same answer is needed by server pages
// (the locked contact row, the quota message) and by client components (the
// message composer, the hire button), and having two copies of "premium comes
// after verified" is how they drift.
//
// Every gated surface in T4/T5 already linked to a packages page. What this
// adds is the ?plan= parameter, so a tutor who has run out of applications
// lands with Premium highlighted rather than on a wall of three equal cards
// and no idea which one solves their problem.

export type Audience = 'tutor' | 'parent'

/** The plan we would sell someone in this position next. */
export function nextPlan(audience: Audience, currentPlan: string | null): string {
  if (audience === 'parent') return 'parent_featured'
  switch (currentPlan) {
    case 'featured':
      return 'featured' // already the top plan; highlight it as current
    case 'premium':
      return 'featured'
    case 'basic':
      return 'premium'
    default:
      // No plan at all: Premium is the first PAID upgrade to highlight. Getting
      // listed at all is the one-time Rs 199 fee (the Verify gate), not a plan.
      return 'premium'
  }
}

export function packagesHref(audience: Audience, plan?: string | null): string {
  const base = audience === 'tutor' ? '/membership-plans?for=tutors' : '/membership-plans?for=parents'
  // `base` already carries `?for=…`, so a second parameter joins with `&`. It was
  // `?plan=` (PR52 §2), which produced `…?for=tutors?plan=premium` — a single
  // malformed query string in which `plan` never parsed, so the target card was
  // never highlighted.
  return plan ? `${base}&plan=${encodeURIComponent(plan)}` : base
}

/**
 * The plan to OFFER a tutor at their monthly apply limit (PR52 §3): the next
 * package up from where they are now — never the same plan, never a lower one —
 * or null at Featured, where there is no higher package. A tutor now on Basic
 * who previously held a paid plan that has since lapsed is pushed to Featured;
 * a Basic tutor who never had a paid plan is offered Premium.
 */
export function tutorApplyOffer(
  currentPlan: string | null,
  hadPaidPlanBefore: boolean,
): string | null {
  if (currentPlan === 'featured') return null
  if (currentPlan === 'premium') return 'featured'
  return hadPaidPlanBefore ? 'featured' : 'premium'
}

/**
 * The href for an "upgrade to do X" prompt.
 *
 * `required` names the plan that actually unlocks the thing being blocked --
 * contact details need Featured whatever the member is on now, so passing it
 * beats guessing from their current plan.
 */
export function upgradeHref(
  audience: Audience,
  currentPlan: string | null,
  required?: string,
): string {
  return packagesHref(audience, required ?? nextPlan(audience, currentPlan))
}
