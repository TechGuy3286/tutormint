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
    case 'verified':
      return 'premium'
    default:
      // No plan at all: Verified is the entry point and the one that gets
      // them listed with a badge.
      return 'verified'
  }
}

export function packagesHref(audience: Audience, plan?: string | null): string {
  const base = audience === 'tutor' ? '/tutor/packages' : '/parent/packages'
  return plan ? `${base}?plan=${encodeURIComponent(plan)}` : base
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
