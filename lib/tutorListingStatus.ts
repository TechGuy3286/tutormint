// lib/tutorListingStatus.ts
//
// "Is this tutor in the PUBLIC directory, and if not, why?" — the TypeScript
// mirror of the tutor_directory view's WHERE clause (migration 87), expressed
// once so the tutor dashboard and the admin tutor list read the same rule and
// neither has to re-implement it.
//
// PURE — no imports, so it is unit-tested and usable on the server or the client.
// It must stay in lockstep with 87_directory_listing_bar.sql: every condition in
// the view is a blocker here, in the same order, so `directoryBlockers(f).length
// === 0` means exactly "this tutor is returned by tutor_directory".
//
// Never report a tutor as listed on the strength of the fee alone — the whole
// point of migration 87 is that the fee is necessary but not sufficient.

export type ListingBlocker =
  | 'banned'
  | 'suspended'
  | 'under_review'
  | 'verification_rejected'
  | 'fixture'
  | 'fee_unpaid'
  | 'phone_unverified'
  | 'unclaimed_import'
  | 'no_subjects'
  | 'no_city'

export type ListingFacts = {
  feePaid: boolean
  phoneVerified: boolean
  hasSubjects: boolean
  city?: string | null
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
 * An empty array means they are listed.
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
  if (!f.feePaid) out.push('fee_unpaid')
  if (!f.phoneVerified) out.push('phone_unverified')
  if (f.imported && !f.claimedAt) out.push('unclaimed_import')
  if (!f.hasSubjects) out.push('no_subjects')
  if (!(f.city && f.city.trim())) out.push('no_city')
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
  fee_unpaid: 'Verification fee not paid',
  phone_unverified: 'Mobile number not verified',
  unclaimed_import: 'Imported profile not claimed',
  no_subjects: 'No subjects added',
  no_city: 'No city set',
}

/**
 * For the tutor's OWN dashboard: the blockers he can fix himself, each with the
 * screen that fixes it. The rest (suspended, banned, under review, rejected,
 * fixture, unclaimed import) are not "add this to get listed" nudges — they are
 * account states surfaced elsewhere, so they return null here.
 */
export function tutorFixFor(b: ListingBlocker): { label: string; href: string } | null {
  // Each opens the EXACT step of the tap-tap flow (PR 4 §1.6), so a "not shown in
  // search" row lands the tutor on the one thing to fix, not a long form. The
  // labels name the ACTUAL missing thing (owner PR5a §1.7) — "Get verified" was
  // ambiguous for a tutor whose CNIC was already submitted — and are used
  // identically here, in the flow final screen and in the apply gate.
  switch (b) {
    case 'fee_unpaid':
      return { label: 'Pay the one-time verification fee', href: '/tutor/complete-profile?step=verify' }
    case 'phone_unverified':
      return { label: 'Verify your mobile number', href: '/tutor/complete-profile?step=mobile' }
    case 'no_subjects':
      return { label: 'Add your subjects', href: '/tutor/complete-profile?step=subjects' }
    case 'no_city':
      return { label: 'Add your city', href: '/tutor/complete-profile?step=city' }
    default:
      return null
  }
}

// The CNIC's sub-state, threaded into the fix list so the "get verified" step
// names what is actually next (owner PR5a §1.7). `state` mirrors the identity
// card's IdentityState (profiles.verification_state), `hasImage` mirrors
// cnic_image_path.
export type CnicState = { hasImage: boolean; state: 'none' | 'submitted' | 'approved' | 'rejected' }

/** One row of the "why you are not listed" list. `href` null + `status:true`
 *  marks an informational row with no action (e.g. "CNIC being checked"). */
export type FixItem = { key: string; label: string; href: string | null; status?: boolean }

/**
 * The fixable blockers as rows, with the fee/verify blocker named by the CNIC
 * sub-state (owner PR5a §1.7). ONE list, so the dashboard not-listed card and
 * the flow final screen show identical labels:
 *   - fee unpaid, no CNIC image yet → "Add your CNIC"
 *   - fee unpaid, CNIC image present → "Pay the one-time verification fee"
 *   - CNIC sent for checking (state 'submitted') → a non-actionable
 *     "CNIC being checked" status row (in addition to any fee row).
 * Listing itself is still `directoryBlockers` alone (governing rule) — the CNIC
 * rows only re-word the fee blocker and surface its review status, they never
 * add a listing requirement.
 */
export function listingFixItems(blockers: ListingBlocker[], cnic?: CnicState): FixItem[] {
  const items: FixItem[] = []
  for (const b of blockers) {
    if (b === 'fee_unpaid') {
      if (cnic && !cnic.hasImage) {
        items.push({ key: 'cnic', label: 'Add your CNIC', href: '/tutor/complete-profile?step=verify' })
      } else {
        items.push({
          key: 'fee',
          label: 'Pay the one-time verification fee',
          href: '/tutor/complete-profile?step=verify',
        })
      }
      continue
    }
    const f = tutorFixFor(b)
    if (f) items.push({ key: b, label: f.label, href: f.href })
  }
  if (cnic && cnic.state === 'submitted') {
    items.push({ key: 'cnic-checking', label: 'CNIC being checked', href: null, status: true })
  }
  return items
}

/** The blockers the tutor can fix himself, each with the screen that fixes it —
 *  the list the apply gate names (owner PR3 §1.3). Non-fixable account states
 *  (suspended/banned/under-review/rejected/fixture/unclaimed) drop out. */
export function listingFixes(blockers: ListingBlocker[]): { label: string; href: string }[] {
  return blockers.map(tutorFixFor).filter((f): f is { label: string; href: string } => f !== null)
}

/** True when the ONLY thing keeping this tutor unlisted is the one-time fee — in
 *  which case the apply gate shows the existing CNIC + verify modal rather than a
 *  list (owner PR3 §1.3). Keyed on the blocker itself, not a link, so the flow
 *  can re-point the fix href (PR 4 §1.6) without changing this decision. */
export function feeOnlyBlocker(blockers: ListingBlocker[]): boolean {
  const fixable = blockers.filter((b) => tutorFixFor(b) !== null)
  return fixable.length === 1 && fixable[0] === 'fee_unpaid'
}

/** A plain, non-scolding sentence naming what is missing — for a surface that
 *  cannot render the modal (e.g. the demo-accept API's error). Visibility only. */
export function listingSummary(blockers: ListingBlocker[]): string {
  const items = listingFixes(blockers).map((f) => f.label.toLowerCase())
  if (items.length === 0) return 'Your profile is not shown to parents yet.'
  const list =
    items.length === 1
      ? items[0]
      : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
  return `You are not shown to parents in search yet — ${list} first.`
}
