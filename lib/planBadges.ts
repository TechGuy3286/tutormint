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

const TUTOR_PLANS = new Set(['verified', 'premium', 'featured'])

/**
 * Which badges a plan grants.
 *
 * `gate` is "may badges show at all" — a tutor's badge clears LISTED (below); a
 * parent's clears profile completion. `hasReviewedDegree` gates the Verified
 * badge for TUTORS only (owner rule, 10 Sep 2026): a paid, listed tutor whose
 * degree has not been reviewed is fully listed and applying, but carries no
 * Verified badge — "badges show only for what was checked". Premium and Featured
 * are plan-tier rewards and are not degree-gated; the parameter is ignored for
 * parent plans (a parent's Verified badge is CNIC + address, not a degree).
 */
export function badgesForPlan(
  plan: string | null | undefined,
  gate: boolean,
  hasReviewedDegree: boolean = true,
): BadgeName[] {
  if (!gate) return []
  let base: BadgeName[]
  switch (plan) {
    case 'featured':
      base = ['Verified', 'Premium', 'Featured']
      break
    case 'premium':
      base = ['Verified', 'Premium']
      break
    case 'verified':
      base = ['Verified']
      break
    case 'parent_featured':
      return ['Verified', 'Featured']
    case 'parent_verified':
      return ['Verified']
    default:
      return []
  }
  // A tutor plan without a reviewed degree keeps its tier badges but not Verified.
  if (TUTOR_PLANS.has(plan as string) && !hasReviewedDegree) {
    return base.filter((b) => b !== 'Verified')
  }
  return base
}

/** True when the plan earns the small gold "Featured" pill on a card. */
export function isFeaturedPlan(plan: string | null | undefined): boolean {
  return plan === 'featured' || plan === 'parent_featured'
}

/**
 * The listing PRECONDITION — everything a tutor needs to be listable EXCEPT the
 * plan. Shared with the payment go-live path (lib/payments/*), which asks "would
 * this tutor be listed if their plan were running?" to decide when a paused,
 * paid plan should start its clock. Kept here, pure, so that question has one
 * answer used by go-live, activation and the entitlements layer alike.
 *
 * "verified" is the tutor's identity approval (the admin's video + CNIC + degree
 * audit); profiles.cnic_verified_at is a PARENT column and is null for every
 * tutor, so verification_status IS a tutor's CNIC-verified fact.
 */
export function tutorListablePrecondition(input: {
  phoneVerified: boolean
  verificationStatus?: string | null
  isSuspended?: boolean | null
  isBanned?: boolean | null
  underReview?: boolean | null
  imported?: boolean | null
  claimedAt?: string | null
}): boolean {
  if (!input.phoneVerified) return false
  if (input.verificationStatus !== 'verified') return false
  if (input.isSuspended || input.isBanned) return false
  if (input.underReview) return false
  if (input.imported && !input.claimedAt) return false
  return true
}

/**
 * Is this tutor LISTED — the `tutor_directory` rule expressed in TypeScript so
 * every badge and dashboard surface shares one definition with the SQL view.
 *
 * NEW RULE (owner, 10 Sep 2026): profile completion NO LONGER gates listing. A
 * tutor is listed when they hold an ACTIVE PAID PLAN and meet the listable
 * precondition (mobile verified, verification 'verified', not suspended / banned
 * / under review, claimed if imported). A paid, verified tutor at 40% is listed
 * and can apply; completion only decides RANKING and INDEXING now, not listing.
 */
export function tutorListed(
  input: { hasActivePaidPlan: boolean } & Parameters<typeof tutorListablePrecondition>[0],
): boolean {
  return input.hasActivePaidPlan && tutorListablePrecondition(input)
}

/**
 * A listed tutor's public profile is NOINDEX below 100% completion (owner rule
 * 3): fully listed, searchable and applying, but held out of Google until the
 * profile is finished. At 100% the noindex lifts automatically — one threshold,
 * no second list of fields. Under review is always noindex (Part 6). Pure, so
 * the profile page and its test read one decision.
 */
export function tutorProfileNoindex(input: {
  profileCompletion: number | null | undefined
  underReview?: boolean | null
}): boolean {
  if (input.underReview) return true
  return (input.profileCompletion ?? 0) < 100
}

/**
 * A listed tutor appears in the SITEMAP only at 100% (mirrors the noindex rule
 * and listed_tutor_slugs). Listed-but-incomplete tutors are on-site searchable
 * yet withheld from the sitemap so the two indexing signals never disagree.
 */
export function tutorSitemapEligible(input: {
  listed: boolean
  profileCompletion: number | null | undefined
}): boolean {
  return input.listed && (input.profileCompletion ?? 0) >= 100
}
