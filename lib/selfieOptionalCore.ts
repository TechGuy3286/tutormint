// lib/selfieOptionalCore.ts
//
// PURE, client-safe. The selfie is OPTIONAL (owner, 12 Nov 2026): 92 tutors were
// stuck at the selfie step and many selfies came out black, so verification now
// rests on staff matching the PROFILE PHOTO to the CNIC. The profile photo is
// still required; the selfie is not, anywhere:
//   - the Verified badge and its pause on a rejection (lib/badgeRule),
//   - Google indexing (lib/seo/indexable + listed_tutor_slugs, migration 230),
//   - People stages and "Documents to approve" (lib/tutorPipelineCore),
//   - the status image and social posts (lib/social/eligibilityCore),
//   - profile completion (lib/profileRequired — an uploaded selfie still counts
//     as done, a missing one is not an item),
//   - onboarding (lib/tutorFlow OPTIONAL_STEPS — "Add later").
// A selfie added later is reviewed as before; once approved, staff and the tutor
// see "Selfie checked ✓" — never a public badge.

/** The button on the selfie step that continues without one. */
export const ADD_LATER_LABEL = 'Add later'

/** The line above it. */
export const SELFIE_OPTIONAL_LINE = 'A selfie is optional. You can add it later from Edit Profile.'

/** The small staff / own-dashboard mark for an approved selfie. */
export const SELFIE_CHECKED_LABEL = 'Selfie checked ✓'

/** Show "Selfie checked ✓" only for an approved selfie. */
export function showSelfieChecked(selfieStatus: string | null | undefined): boolean {
  return String(selfieStatus ?? '').trim().toLowerCase() === 'approved'
}
