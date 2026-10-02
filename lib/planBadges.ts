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

import { tutorProfileIndexable } from '@/lib/seo/indexable'

export type BadgeName = 'Verified' | 'Premium' | 'Featured'

/**
 * Which badges a plan grants.
 *
 * `gate` is "may badges show at all" — a tutor's badge clears LISTED; a parent's
 * clears profile completion. `verifiedOk` gates the VERIFIED badge specifically
 * (PR105-B §1), REPLACING the old reviewed-degree rule:
 *   - a TUTOR earns Verified only when staff have approved CNIC, photo and selfie
 *     (the fee is implied by holding a tutor plan),
 *   - a PARENT earns Verified only when their CNIC is verified.
 * Premium and Featured are plan-tier rewards and are NOT gated by verifiedOk.
 * The caller supplies verifiedOk from lib/badgeFacts (batched for lists).
 */
export function badgesForPlan(
  plan: string | null | undefined,
  gate: boolean,
  verifiedOk: boolean = true,
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
    // Basic is the free tier a tutor is on after paying the one-time Rs 199 fee.
    // The old 'verified' plan code survives only as the fee marker.
    case 'basic':
    case 'verified':
      base = ['Verified']
      break
    case 'parent_featured':
      base = ['Verified', 'Featured']
      break
    case 'parent_verified':
      base = ['Verified']
      break
    default:
      return []
  }
  // Verified shows only when the identity checks for this member passed; the
  // tier badges (Premium/Featured) stay regardless.
  if (!verifiedOk) return base.filter((b) => b !== 'Verified')
  return base
}

/** True when the plan earns the small gold "Featured" pill on a card. */
export function isFeaturedPlan(plan: string | null | undefined): boolean {
  return plan === 'featured' || plan === 'parent_featured'
}

/**
 * The listing PRECONDITION — everything a tutor needs to be listable EXCEPT the
 * one-time fee. Shared with the payment go-live path (lib/payments/*), which asks
 * "would this tutor be listed if their fee were recorded?" to decide when a
 * paused, paid Premium/Featured plan should start its clock. Kept here, pure, so
 * that question has one answer used by go-live, activation and the entitlements
 * layer alike.
 *
 * verification_status is the tutor's identity STATE (profiles.cnic_verified_at is
 * a PARENT column and is null for every tutor). Under the one-time-fee model
 * (owner, 15 Sep 2026) paying the fee is what verifies a tutor, so a still-pending
 * status does NOT hold them out — only an explicit suspended/rejected does.
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
  if (input.verificationStatus === 'suspended' || input.verificationStatus === 'rejected') return false
  if (input.isSuspended || input.isBanned) return false
  if (input.underReview) return false
  if (input.imported && !input.claimedAt) return false
  return true
}

/**
 * Is this tutor LISTED — the `tutor_directory` rule expressed in TypeScript so
 * every badge and dashboard surface shares one definition with the SQL view.
 *
 * ONE-TIME FEE MODEL (owner, 15 Sep 2026): the Rs 199 verification fee, not an
 * active paid plan, is what lists a tutor. A tutor is listed when the fee is
 * recorded (`feePaid`) and the precondition holds (mobile verified, verification
 * not suspended/rejected, not suspended/banned/under review, claimed if
 * imported). After the fee they are on the free Basic tier; Premium/Featured are
 * upgrades that add powers, never a listing requirement. Completion decides
 * RANKING and INDEXING only, not listing.
 */
export function tutorListed(
  input: { feePaid: boolean } & Parameters<typeof tutorListablePrecondition>[0],
): boolean {
  return input.feePaid && tutorListablePrecondition(input)
}

/**
 * A listed tutor's public profile is NOINDEX until STEP 1 is complete (owner, 15
 * Sep 2026): verified mobile, CNIC approved, profile picture approved, selfie
 * approved, at least one subject, a city, at least one area, and the fee paid.
 * The profile is fully listed, searchable and applying meanwhile, but held out of
 * Google until step 1 finishes; the noindex lifts automatically the moment it
 * does. Under review is always noindex (Part 6).
 *
 * SEED WINS (owner, 10 Sep 2026): a fixture tutor (profiles.is_seed) is noindex
 * regardless — a seed cast member must never reach Google. They stay visible and
 * searchable on-site; this only holds back search engines. Pure, so the profile
 * page and its test read one decision.
 */
export function tutorProfileNoindex(input: {
  /** The one-time verification fee is paid. PR100: unverified → noindex. */
  verified?: boolean | null
  /** profiles.profile_completion — the dashboard %. Indexing needs 100. */
  completion?: number | null
  /** Staff approvals (PR105 §3). */
  cnicApproved?: boolean | null
  profilePicApproved?: boolean | null
  selfieApproved?: boolean | null
  underReview?: boolean | null
  isSeed?: boolean | null
}): boolean {
  // PR37 §2 / PR100 / PR105 — the ONE indexability rule lives in lib/seo/indexable;
  // this stays as the tutor page's entry point (its callers import it here).
  return !tutorProfileIndexable({
    feePaid: input.verified,
    completion: input.completion,
    cnicApproved: input.cnicApproved,
    profilePicApproved: input.profilePicApproved,
    selfieApproved: input.selfieApproved,
    underReview: input.underReview,
    isSeed: input.isSeed,
  })
}

/**
 * A listed tutor appears in the SITEMAP only when their page is indexable —
 * completion = 100 AND fee paid, and not a seed/under-review fixture (owner,
 * PR100; mirrors listed_tutor_slugs). Listed tutors below 100% or unpaid are
 * on-site searchable yet withheld from the sitemap so the two indexing signals
 * never disagree.
 */
export function tutorSitemapEligible(input: {
  listed: boolean
  verified?: boolean | null
  completion?: number | null
  cnicApproved?: boolean | null
  profilePicApproved?: boolean | null
  selfieApproved?: boolean | null
  isSeed?: boolean | null
  underReview?: boolean | null
}): boolean {
  if (!input.listed) return false
  return tutorProfileIndexable({
    feePaid: input.verified,
    completion: input.completion,
    cnicApproved: input.cnicApproved,
    profilePicApproved: input.profilePicApproved,
    selfieApproved: input.selfieApproved,
    isSeed: input.isSeed,
    underReview: input.underReview,
  })
}
