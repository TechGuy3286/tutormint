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
  | 'subjects'
  | 'mobile'
  | 'verify'
  | 'jobtype'
  | 'area'
  | 'name'
  | 'gender'
  | 'photo'
  | 'tagline'
  | 'bio'
  | 'experience'
  | 'fee'
  | 'degree'
  | 'cnic'
  | 'video'

// Blockers FIRST (owner §1.3: city, subjects, mobile, verification/fee), then the
// rest (job type — which subsumes the retired "mode" and, via the subjects step,
// "level"; area, then the remaining completion items). A blocker cannot be
// skipped (§1.7).
export const FLOW_ORDER: FlowStepKey[] = [
  'city',
  'subjects',
  'mobile',
  'verify',
  'jobtype',
  'area',
  'name',
  'gender',
  'photo',
  'tagline',
  'bio',
  'experience',
  'fee',
  'degree',
  'cnic',
  'video',
]

/** The listing blockers a tutor fixes in the flow — not skippable. */
export const BLOCKER_STEPS: ReadonlySet<FlowStepKey> = new Set([
  'city',
  'subjects',
  'mobile',
  'verify',
])

/** The completion-item key (lib/profileChecklist) → the flow step that fixes it,
 *  so the dashboard card and every "what's missing" link open the exact step
 *  (§1.6). "mode" is the Job Type step; "phone" is the mobile step. */
export const COMPLETION_KEY_TO_STEP: Record<string, FlowStepKey> = {
  verify: 'verify',
  name: 'name',
  gender: 'gender',
  city: 'city',
  area: 'area',
  photo: 'photo',
  tagline: 'tagline',
  bio: 'bio',
  subjects: 'subjects',
  experience: 'experience',
  fee: 'fee',
  mode: 'jobtype',
  degrees: 'degree',
  cnic: 'cnic',
  phone: 'mobile',
  video: 'video',
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
  cnicNumber: string | null
  cnicImagePath: string | null
  subjectCount: number
  phoneVerified: boolean
  feePaid: boolean
  videoDone: boolean
  // Account-state facts, for the directory ("You're listed") check.
  isSeed: boolean
  isTeamAccount: boolean
  isBanned: boolean
  isSuspended: boolean
  underReview: boolean
  verificationStatus: string | null
  imported: boolean
  claimedAt: string | null
}

const nonblank = (v: string | null | undefined): boolean => !!(v && v.trim())

/** Is this step already filled? Mirrors the completion checklist / blockers. */
export function stepDone(f: FlowFacts, key: FlowStepKey): boolean {
  switch (key) {
    case 'city':
      return nonblank(f.city)
    case 'subjects':
      return f.subjectCount > 0
    case 'mobile':
      return f.phoneVerified
    case 'verify':
      return f.feePaid
    case 'jobtype':
      return f.jobTypes.length > 0
    case 'area':
      return nonblank(f.area)
    case 'name':
      return nonblank(f.fullName)
    case 'gender':
      return nonblank(f.gender)
    case 'photo':
      return nonblank(f.avatarUrl)
    case 'tagline':
      return nonblank(f.headline)
    case 'bio':
      return nonblank(f.bio)
    case 'experience':
      return f.experienceYears != null && f.experienceYears >= 0
    case 'fee':
      return f.hourlyRate != null && f.hourlyRate > 0
    case 'degree':
      return f.degreesCount > 0 && f.degreeDocCount > 0
    case 'cnic':
      return nonblank(f.cnicNumber) && nonblank(f.cnicImagePath)
    case 'video':
      return f.videoDone
  }
}

/** The missing steps, in flow order. */
export function missingSteps(f: FlowFacts): FlowStepKey[] {
  return FLOW_ORDER.filter((k) => !stepDone(f, k))
}

/** The first missing step, or null when nothing is missing. */
export function firstMissingStep(f: FlowFacts): FlowStepKey | null {
  return FLOW_ORDER.find((k) => !stepDone(f, k)) ?? null
}

/** The next missing step strictly AFTER `from` in flow order (for "Next"/"Skip"),
 *  or null when there is none. */
export function nextMissingAfter(f: FlowFacts, from: FlowStepKey): FlowStepKey | null {
  const i = FLOW_ORDER.indexOf(from)
  for (let j = i + 1; j < FLOW_ORDER.length; j++) {
    if (!stepDone(f, FLOW_ORDER[j])) return FLOW_ORDER[j]
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
  }
}

/** The final screen's verdict: VISIBLE when directoryBlockers is empty (PR16 §1). */
export function isListed(f: FlowFacts): boolean {
  return directoryBlockers(toListingFacts(f)).length === 0
}
