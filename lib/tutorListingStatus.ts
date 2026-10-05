// lib/tutorListingStatus.ts
//
// ONE SOURCE (owner, 5 Oct 2026, item 8): the tutor_directory VIEW decides who
// appears in Browse, search, the landing pages, the shortlist and the sitemap,
// and `directoryBlockers` below is its exact TypeScript mirror — condition for
// condition, in the view's order (migrations 127 + 137). The live test
// scripts/test-directory-live.ts fails if the two ever disagree for any account.
//
// The step-1 completeness items (verified mobile, subjects, city, area, gender)
// are NOT listing gates since migration 124 ("list every real tutor"). They are
// PROFILE GAPS — what a tutor still needs for the Verified badge, the plan clock
// and Google — and live in `profileGaps`, a separate function, so no surface can
// mistake a nudge for a listing reason.
//
// PURE — no imports, so it is unit-tested and usable on the server or the client.

export type ListingBlocker =
  // --- the view's own conditions (directoryBlockers) ---
  | 'not_tutor'
  | 'banned'
  | 'suspended'
  | 'under_review'
  | 'verification_rejected'
  | 'unclaimed_import'
  | 'fixture'
  | 'hidden'
  | 'document_rejected'
  // --- profile gaps (profileGaps) — nudges, never listing reasons ---
  | 'phone_unverified'
  | 'no_subjects'
  | 'no_city'
  | 'no_area'
  | 'no_gender'

export type ListingFacts = {
  /** profiles.role — the view lists role = 'tutor' only. Absent = assumed tutor
   *  (every caller today loads a tutor). */
  role?: string | null
  isSuspended?: boolean | null
  isBanned?: boolean | null
  underReview?: boolean | null
  verificationStatus?: string | null
  imported?: boolean | null
  claimedAt?: string | null
  isSeed?: boolean | null
  isTeamAccount?: boolean | null
  /** profiles.hidden_from_public (migration 126). */
  hiddenFromPublic?: boolean | null
  /** §5 (migration 137): staff REJECTED the CNIC / profile picture / selfie. */
  cnicRejected?: boolean | null
  photoRejected?: boolean | null
  selfieRejected?: boolean | null
  // Profile-gap facts (profileGaps only).
  phoneVerified?: boolean | null
  hasSubjects?: boolean | null
  city?: string | null
  area?: string | null
  gender?: string | null
}

/**
 * Every reason this account is NOT in tutor_directory, in the view's own order.
 * Empty means the view returns them. Mirrors, exactly:
 *   role = 'tutor' AND NOT suspended AND NOT banned AND NOT under_review
 *   AND verification_status NOT IN (suspended, rejected) AND (not imported OR claimed)
 *   AND NOT is_seed AND NOT is_team_account AND NOT hidden_from_public
 *   AND verification_state / profile_pic_status / selfie_status <> 'rejected'
 */
export function directoryBlockers(f: ListingFacts): ListingBlocker[] {
  const out: ListingBlocker[] = []
  if (f.role !== undefined && f.role !== null && f.role !== 'tutor') out.push('not_tutor')
  if (f.isSuspended) out.push('suspended')
  if (f.isBanned) out.push('banned')
  if (f.underReview) out.push('under_review')
  if (f.verificationStatus === 'suspended' || f.verificationStatus === 'rejected') out.push('verification_rejected')
  if (f.imported && !f.claimedAt) out.push('unclaimed_import')
  if (f.isSeed || f.isTeamAccount) out.push('fixture')
  if (f.hiddenFromPublic) out.push('hidden')
  if (f.cnicRejected || f.photoRejected || f.selfieRejected) out.push('document_rejected')
  return out
}

export function isDirectoryListed(f: ListingFacts): boolean {
  return directoryBlockers(f).length === 0
}

/**
 * The step-1 profile gaps — NOT listing gates. What a tutor still needs to be
 * found on Google, earn the badge and start a paid plan's clock (lib/payments/
 * listable). Each has a fix screen (tutorFixFor).
 */
export function profileGaps(f: ListingFacts): ListingBlocker[] {
  const out: ListingBlocker[] = []
  if (!f.phoneVerified) out.push('phone_unverified')
  if (!f.hasSubjects) out.push('no_subjects')
  if (!(f.city && f.city.trim())) out.push('no_city')
  if (!(f.area && f.area.trim())) out.push('no_area')
  if (!(f.gender && f.gender.trim())) out.push('no_gender')
  return out
}

/** A plain, non-scolding label for each reason — used on the admin list. */
export const BLOCKER_LABEL: Record<ListingBlocker, string> = {
  not_tutor: 'Not a tutor account',
  banned: 'Account banned',
  suspended: 'Account suspended',
  under_review: 'Under review',
  verification_rejected: 'Verification rejected',
  unclaimed_import: 'Imported profile not claimed',
  fixture: 'Seed / fixture account',
  hidden: 'Hidden from the public directory',
  document_rejected: 'A document was rejected — awaiting a correct re-upload',
  phone_unverified: 'Mobile number not verified',
  no_subjects: 'No subjects added',
  no_city: 'No city set',
  no_area: 'No area set',
  no_gender: 'No gender set',
}

/**
 * For the tutor's OWN dashboard/onboarding: the items he can fix himself, each
 * with the screen that fixes it. Account states (suspended, banned, under
 * review, rejected verification, fixture, unclaimed import, hidden) return null —
 * they are surfaced elsewhere. Every fix opens the EXACT step of the tap-tap flow.
 */
export function tutorFixFor(b: ListingBlocker): { label: string; href: string } | null {
  switch (b) {
    case 'phone_unverified':
      return { label: 'Verify your mobile number', href: '/tutor/complete-profile?step=mobile' }
    case 'no_subjects':
      return { label: 'Add your subjects', href: '/tutor/complete-profile?step=subjects' }
    case 'no_city':
      return { label: 'Add your city', href: '/tutor/complete-profile?step=city' }
    case 'no_area':
      return { label: 'Add your area', href: '/tutor/complete-profile?step=area' }
    case 'no_gender':
      return { label: 'Add your gender', href: '/tutor/complete-profile?step=gender' }
    case 'document_rejected':
      // The identity section of Settings — the same screen the block modal opens
      // (lib/badgeRule REUPLOAD_HREF; this file stays import-free).
      return { label: 'Upload a correct document', href: '/tutor/dashboard/settings#identity' }
    default:
      return null
  }
}

/** One row of the "what to fix" list. */
export type FixItem = { key: string; label: string; href: string | null; status?: boolean }

/** The fixable items as rows — ONE list, so every surface shows identical labels. */
export function listingFixItems(blockers: ListingBlocker[]): FixItem[] {
  const items: FixItem[] = []
  for (const b of blockers) {
    const f = tutorFixFor(b)
    if (f) items.push({ key: b, label: f.label, href: f.href })
  }
  return items
}

/** The fixable items, each with the screen that fixes it. */
export function listingFixes(blockers: ListingBlocker[]): { label: string; href: string }[] {
  return blockers.map(tutorFixFor).filter((f): f is { label: string; href: string } => f !== null)
}

/** A plain, non-scolding sentence naming what is missing — for a surface that
 *  cannot render a list (e.g. the demo-accept API's error). */
export function listingSummary(blockers: ListingBlocker[]): string {
  const items = listingFixes(blockers).map((f) => f.label.toLowerCase())
  if (items.length === 0) return 'Your profile is not shown to parents yet.'
  const list =
    items.length === 1
      ? items[0]
      : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
  return `You are not shown to parents in search yet — ${list} first.`
}
