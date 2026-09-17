// lib/tutorListingStatus.ts
//
// "Is this tutor VISIBLE — in /browse/tutors with a public profile — and if not,
// why?" The TypeScript mirror of the tutor_directory view's WHERE clause
// (migration 94), expressed once so the dashboard, onboarding, the admin list and
// the apply/message surfaces read the same rule and none re-implements it.
//
// PR16 §1 — THE FEE NO LONGER GATES VISIBILITY. A tutor is visible when: mobile
// verified, city AND area set, at least one subject, gender set, not suspended,
// not banned, not under review, verification not suspended/rejected, not a
// seed/team fixture, and claimed if imported. The one-time fee separately controls
// the Verified badge, ranking, applying, and reading/replying to parent messages
// and demos (that is `ent.verified`, decided in lib/entitlements.ts — NOT here).
//
// PURE — no imports, so it is unit-tested and usable on the server or the client.
// Keep it in lockstep with 94_visibility_rule.sql: every condition in the view is
// a blocker here, in the same order, so `directoryBlockers(f).length === 0` means
// exactly "this tutor is returned by tutor_directory".

export type ListingBlocker =
  | 'banned'
  | 'suspended'
  | 'under_review'
  | 'verification_rejected'
  | 'fixture'
  | 'phone_unverified'
  | 'unclaimed_import'
  | 'no_subjects'
  | 'no_city'
  | 'no_area'
  | 'no_gender'

export type ListingFacts = {
  phoneVerified: boolean
  hasSubjects: boolean
  city?: string | null
  area?: string | null
  gender?: string | null
  isSuspended?: boolean | null
  isBanned?: boolean | null
  underReview?: boolean | null
  verificationStatus?: string | null
  imported?: boolean | null
  claimedAt?: string | null
  isSeed?: boolean | null
  isTeamAccount?: boolean | null
}

/**
 * Every reason this tutor is NOT in tutor_directory, in the view's own order.
 * An empty array means they are visible. The fee is deliberately absent — it no
 * longer gates visibility (PR16 §1).
 */
export function directoryBlockers(f: ListingFacts): ListingBlocker[] {
  const out: ListingBlocker[] = []
  if (f.isBanned) out.push('banned')
  if (f.isSuspended) out.push('suspended')
  if (f.underReview) out.push('under_review')
  if (f.verificationStatus === 'suspended' || f.verificationStatus === 'rejected') {
    out.push('verification_rejected')
  }
  // profiles has no is_fixture column — a fixture tutor is a seed account
  // (is_seed) or the one team-operated account (is_team_account).
  if (f.isSeed || f.isTeamAccount) out.push('fixture')
  if (!f.phoneVerified) out.push('phone_unverified')
  if (f.imported && !f.claimedAt) out.push('unclaimed_import')
  if (!f.hasSubjects) out.push('no_subjects')
  if (!(f.city && f.city.trim())) out.push('no_city')
  if (!(f.area && f.area.trim())) out.push('no_area')
  if (!(f.gender && f.gender.trim())) out.push('no_gender')
  return out
}

export function isDirectoryListed(f: ListingFacts): boolean {
  return directoryBlockers(f).length === 0
}

/** A plain, non-scolding label for each reason — used on the admin list. */
export const BLOCKER_LABEL: Record<ListingBlocker, string> = {
  banned: 'Account banned',
  suspended: 'Account suspended',
  under_review: 'Under review',
  verification_rejected: 'Verification rejected',
  fixture: 'Seed / fixture account',
  phone_unverified: 'Mobile number not verified',
  unclaimed_import: 'Imported profile not claimed',
  no_subjects: 'No subjects added',
  no_city: 'No city set',
  no_area: 'No area set',
  no_gender: 'No gender set',
}

/**
 * For the tutor's OWN dashboard/onboarding: the blockers he can fix himself, each
 * with the screen that fixes it. The rest (suspended, banned, under review,
 * rejected, fixture, unclaimed import) are account states surfaced elsewhere, so
 * they return null here. Every fix opens the EXACT step of the tap-tap flow.
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
    default:
      return null
  }
}

/** One row of the "why you are not visible" list. */
export type FixItem = { key: string; label: string; href: string | null; status?: boolean }

/**
 * The fixable blockers as rows — ONE list, so the dashboard not-visible card and
 * the onboarding final screen show identical labels. Visibility is the positive
 * profile fields now (mobile, city, area, subjects, gender); the fee is not a
 * visibility requirement, so it never appears here.
 */
export function listingFixItems(blockers: ListingBlocker[]): FixItem[] {
  const items: FixItem[] = []
  for (const b of blockers) {
    const f = tutorFixFor(b)
    if (f) items.push({ key: b, label: f.label, href: f.href })
  }
  return items
}

/** The blockers the tutor can fix himself, each with the screen that fixes it —
 *  the list a "you are not shown to parents yet" surface names. Non-fixable
 *  account states drop out. */
export function listingFixes(blockers: ListingBlocker[]): { label: string; href: string }[] {
  return blockers.map(tutorFixFor).filter((f): f is { label: string; href: string } => f !== null)
}

/** A plain, non-scolding sentence naming what is missing — for a surface that
 *  cannot render a list (e.g. the demo-accept API's error). Visibility only. */
export function listingSummary(blockers: ListingBlocker[]): string {
  const items = listingFixes(blockers).map((f) => f.label.toLowerCase())
  if (items.length === 0) return 'Your profile is not shown to parents yet.'
  const list =
    items.length === 1
      ? items[0]
      : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
  return `You are not shown to parents in search yet — ${list} first.`
}
