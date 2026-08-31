// lib/planBadges.ts
//
// The pure, client-safe half of the entitlements layer.
//
// Split out of lib/entitlements.ts because that module imports the Supabase
// server and service-role clients, and importing it from a client component
// dragged next/headers into the browser bundle -- which fails the build, and
// would have been a far worse problem if it had merely warned.
//
// Nothing here reads data or makes a decision about a real member. It maps a
// plan code that the SERVER already resolved to the badges that plan grants.
// A client component can render a badge; it can never grant one.

export type BadgeName = 'Verified' | 'Premium' | 'Featured'

/**
 * Which badges a plan grants, given the profile is finished.
 *
 * "Profile completion (100%) is mandatory before any badge shows" -- a tutor
 * may pay first, and the badge appears when completion reaches 100.
 */
export function badgesForPlan(
  plan: string | null | undefined,
  profileComplete: boolean,
): BadgeName[] {
  if (!profileComplete) return []
  switch (plan) {
    case 'featured':
      return ['Verified', 'Premium', 'Featured']
    case 'premium':
      return ['Verified', 'Premium']
    case 'verified':
      return ['Verified']
    case 'parent_featured':
      return ['Verified', 'Featured']
    case 'parent_verified':
      return ['Verified']
    default:
      return []
  }
}

/** True when the plan earns the small gold "Featured" pill on a card. */
export function isFeaturedPlan(plan: string | null | undefined): boolean {
  return plan === 'featured' || plan === 'parent_featured'
}
