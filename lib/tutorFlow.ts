// lib/tutorFlow.ts
//
// The gap-based tutor completion flow's PURE brain (PR 4 §1). One question per
// screen; the flow computes what is MISSING from the same facts the completion
// widget (lib/profileChecklist) and directoryBlockers (lib/tutorListingStatus)
// read, opens at the first missing step, and skips every step already filled.
//
// PURE — no React, no I/O — so the ordering, the per-step "done" test and the
// "is this tutor listed yet?" check are unit-tested (scripts/test-tutorflow.ts)
// even though the screens themselves cannot be exercised without a browser.

import { directoryBlockers, type ListingFacts } from '@/lib/tutorListingStatus'

export type FlowStepKey =
  | 'city'
  | 'level'
  | 'subjects'
  | 'contact'
  | 'verify'
  | 'jobtype'
  | 'area'
  | 'name'
  | 'photo'
  | 'selfie'
  | 'experience'
  | 'fee'
  | 'availability'
  | 'degree'
  | 'cnic_number'
  | 'cnic_photos'
  // PR106-G3 §3.10: the NEW flow asks gender as its own first step (the current
  // flow collects it inside 'contact', so 'gender' never appears in FLOW_ORDER).
  | 'gender'
  // PR106-G4a §3: the NEW flow collects the tagline + bio as their own step
  // (AI-written, editable) after the CNIC photos; the current flow collects them
  // inside 'contact', so 'tagline' never appears in FLOW_ORDER.
  | 'tagline'

// PR76 §C.1 / PR78 §C — the owner's order:
//   1 City · 2 Areas · 3 Academic levels · 4 Subjects · 5 Job title ·
//   6 Time slots · 7 Contact and about you · 8 Education & certifications ·
//   9 Experience · 10 Expected fee · 11 Photo · 12 Selfie · 13 CNIC ·
//   14 Verification Fee.
// Step 7 "Contact and about you" is now ONE screen (PR78 §C): the 'contact' step
// carries the mobile (verified/read-only or verify-by-SMS), WhatsApp, email,
// gender, tagline and bio together — replacing the old separate mobile/gender/
// tagline/bio steps. 'name' (set at signup) stays its own step, before it, and is
// skipped when already filled. The Verification Fee ('verify') is LAST — a tutor
// answers everything before paying. The gap flow opens at the first missing step
// and skips filled ones.
export const FLOW_ORDER: FlowStepKey[] = [
  'city',
  'area',
  'level',
  'subjects',
  'jobtype',
  'availability',
  'name',
  'contact',
  'degree',
  'experience',
  'fee',
  'photo',
  'selfie',
  'cnic_number',
  'cnic_photos',
  'verify',
]

// PR106-G3 §3.9: the NEW onboarding order (behind the staff switch). Gender
// first, then the current steps re-sequenced; 'name' is omitted (set at signup,
// never re-asked). Both flows save to the same fields, so a tutor switching
// between them loses nothing.
export const NEW_FLOW_ORDER: FlowStepKey[] = [
  'gender',
  'city',
  'area',
  'level',
  'subjects',
  'jobtype',
  'fee',
  'experience',
  'degree',
  'availability',
  'contact',
  'photo',
  'selfie',
  'cnic_number',
  'cnic_photos',
  'tagline',
  'verify',
]

/** The listing blockers a tutor fixes in the flow — not skippable. Level is the
 *  first half of choosing subjects (PR69), so it is a blocker like subjects. The
 *  'contact' step is a blocker because a VERIFIED mobile is a listing requirement
 *  (PR78 §C folded the old 'mobile' blocker into it). */
export const BLOCKER_STEPS: ReadonlySet<FlowStepKey> = new Set([
  'city',
  'level',
  'subjects',
  'contact',
  'verify',
])

/** The completion-item key (lib/profileChecklist) → the flow step that fixes it,
 *  so the dashboard card and every "what's missing" link open the exact step
 *  (§1.6). "mode" is the Job Type step; phone/gender/tagline/bio all live on the
 *  one 'contact' step now (PR78 §C). */
export const COMPLETION_KEY_TO_STEP: Record<string, FlowStepKey> = {
  verify: 'verify',
  name: 'name',
  gender: 'contact',
  city: 'city',
  area: 'area',
  photo: 'photo',
  tagline: 'contact',
  bio: 'contact',
  subjects: 'subjects',
  experience: 'experience',
  fee: 'fee',
  mode: 'jobtype',
  degrees: 'degree',
  cnic: 'cnic_number',
  phone: 'contact',
}

/** The facts every step's "done" test reads — a superset of the completion input
 *  and the directory facts, loaded once by the flow. */
export type FlowFacts = {
  fullName: string | null
  gender: string | null
  city: string | null
  area: string | null
  avatarUrl: string | null
  headline: string | null
  bio: string | null
  experienceYears: number | null
  hourlyRate: number | null
  jobTypes: string[]
  degreesCount: number
  degreeDocCount: number
  /** PR106-A: the raw tutor_profiles.degrees array, so the Education step can
   *  prefill the multi-degree editor (parsed via lib/degrees). */
  degrees: unknown[]
  cnicNumber: string | null
  cnicImagePath: string | null
  subjectCount: number
  selfieDone: boolean
  availabilityCount: number
  phoneVerified: boolean
  /** PR86: the WhatsApp number is a required part of the contact step. */
  whatsapp: string | null
  feePaid: boolean
  /** PR78 §D: the tutor answered "No degree to add yet", so the Education step is
   *  answered without a degree. */
  noDegreeYet: boolean
  // Account-state facts, for the directory ("You're listed") check.
  isSeed: boolean
  isTeamAccount: boolean
  isBanned: boolean
  isSuspended: boolean
  underReview: boolean
  verificationStatus: string | null
  imported: boolean
  claimedAt: string | null
  /** profiles.hidden_from_public (migration 126) — part of the directory rule. */
  hiddenFromPublic?: boolean
  /** Staff rejected the CNIC / picture / selfie (migration 137) — delists. */
  cnicRejected?: boolean
  photoRejected?: boolean
  selfieRejected?: boolean
}

const nonblank = (v: string | null | undefined): boolean => !!(v && v.trim())

/** Is this step already filled? Mirrors the completion checklist / blockers. */
export function stepDone(f: FlowFacts, key: FlowStepKey): boolean {
  switch (key) {
    case 'city':
      return nonblank(f.city)
    // Level and subjects are two halves of one choice (PR69): both are "done"
    // exactly when the tutor has subjects, so a new tutor flows level → subjects
    // and an existing tutor (who already has subjects) skips both, untouched.
    case 'level':
      return f.subjectCount > 0
    case 'subjects':
      return f.subjectCount > 0
    case 'verify':
      return f.feePaid
    case 'jobtype':
      return f.jobTypes.length > 0
    case 'area':
      return nonblank(f.area)
    case 'name':
      return nonblank(f.fullName)
    // PR78 §C / PR86 — the one "Contact and about you" screen. Its REQUIRED parts
    // are a verified mobile (a listing blocker), a WhatsApp number, gender, tagline
    // and bio; email stays optional. WhatsApp is NOT a listing/apply gate (see
    // directoryBlockers / needsOnboarding) — only a step-completion requirement.
    case 'contact':
      return f.phoneVerified && nonblank(f.whatsapp) && nonblank(f.gender) && nonblank(f.headline) && nonblank(f.bio)
    case 'photo':
      return nonblank(f.avatarUrl)
    // The verification selfie reads as done once a selfie document is on file
    // (PR70). PR78 §D removed the "Later" skip — it is uploaded, not skipped.
    case 'selfie':
      return f.selfieDone
    case 'experience':
      return f.experienceYears != null && f.experienceYears >= 0
    case 'fee':
      return f.hourlyRate != null && f.hourlyRate > 0
    // PR78 §D removed the "Later" skip — a time slot is picked (answered by
    // tapping). Done once at least one slot exists.
    case 'availability':
      return f.availabilityCount > 0
    // PR78 §D — answered by a real degree + certificate, OR the explicit
    // "No degree to add yet" answer.
    case 'degree':
      // PR106-A §4: a typed degree is enough — the certificate is optional. Done
      // once at least one degree is listed, or the tutor answered "none yet".
      return f.degreesCount > 0 || f.noDegreeYet
    // PR106-D §1.2 — the CNIC step is split: screen (a) is the number, screen
    // (b) the photos. Each is done by its own half.
    case 'cnic_number':
      return nonblank(f.cnicNumber)
    case 'cnic_photos':
      return nonblank(f.cnicImagePath)
    // PR106-G3 §3.10 — the new flow's first step.
    case 'gender':
      return nonblank(f.gender)
    // PR106-G4a §3 — the new flow's tagline + bio step (done when both exist).
    case 'tagline':
      return nonblank(f.headline) && nonblank(f.bio)
  }
}

/** The missing steps, in flow order. */
export function missingSteps(f: FlowFacts, order: FlowStepKey[] = FLOW_ORDER): FlowStepKey[] {
  return order.filter((k) => !stepDone(f, k))
}

/** The first missing step, or null when nothing is missing. */
export function firstMissingStep(f: FlowFacts, order: FlowStepKey[] = FLOW_ORDER): FlowStepKey | null {
  return order.find((k) => !stepDone(f, k)) ?? null
}

/** The next missing step strictly AFTER `from` in flow order (for "Next"/"Skip"),
 *  or null when there is none. */
export function nextMissingAfter(f: FlowFacts, from: FlowStepKey, order: FlowStepKey[] = FLOW_ORDER): FlowStepKey | null {
  const i = order.indexOf(from)
  for (let j = i + 1; j < order.length; j++) {
    if (!stepDone(f, order[j])) return order[j]
  }
  return null
}

/** The facts the visibility rule reads, projected out of the flow facts. The fee
 *  is no longer a visibility gate (PR16 §1), so it is not projected here. */
export function toListingFacts(f: FlowFacts): ListingFacts {
  return {
    phoneVerified: f.phoneVerified,
    hasSubjects: f.subjectCount > 0,
    city: f.city,
    area: f.area,
    gender: f.gender,
    isSuspended: f.isSuspended,
    isBanned: f.isBanned,
    underReview: f.underReview,
    verificationStatus: f.verificationStatus,
    imported: f.imported,
    claimedAt: f.claimedAt,
    isSeed: f.isSeed,
    isTeamAccount: f.isTeamAccount,
    hiddenFromPublic: f.hiddenFromPublic ?? false,
    cnicRejected: f.cnicRejected ?? false,
    photoRejected: f.photoRejected ?? false,
    selfieRejected: f.selfieRejected ?? false,
  }
}

/** The final screen's verdict: LISTED when the directory view's rule holds
 *  (directoryBlockers empty — item 8, one source). Step-1 gaps are nudges. */
export function isListed(f: FlowFacts): boolean {
  return directoryBlockers(toListingFacts(f)).length === 0
}
