// lib/onboardingStopCore.ts
//
// "Stopped at: <step>" for Admin → People (hotfix, 7 Oct 2026). PURE: the step
// a tutor stopped at is the FIRST step of the live onboarding (NEW_FLOW_ORDER)
// that is not yet done — computed from the same facts and the same stepDone()
// rule the onboarding screens use, so admin and the flow can never disagree.
// No new column: nothing is tracked, it is read off the profile.

import { NEW_FLOW_ORDER, firstMissingStep, type FlowFacts, type FlowStepKey } from '@/lib/tutorFlow'

export const STEP_LABEL: Record<FlowStepKey, string> = {
  gender: 'Gender',
  city: 'City',
  area: 'Areas',
  level: 'Subjects',
  subjects: 'Subjects',
  jobtype: 'Job type',
  fee: 'Fee',
  experience: 'Experience',
  degree: 'Education',
  availability: 'Availability',
  contact: 'Contact',
  photo: 'Photo',
  selfie: 'Selfie',
  cnic_number: 'CNIC number',
  cnic_photos: 'CNIC photos',
  tagline: 'Tagline and bio',
  verify: 'Verification fee',
  name: 'Name',
}

/** Stops that come BEFORE the onboarding flow (owner, 8 Oct 2026, items 7–8).
 *  An email signup that never clicked its confirmation link never reached the
 *  flow at all; a tutor who never verified their mobile is called and verified
 *  by staff. Without these, both read as "Gender" — the flow's first step —
 *  which is where 27 tutors appeared to be stuck. */
export const EMAIL_NOT_CONFIRMED = 'Email not confirmed'
export const MOBILE_NOT_VERIFIED = 'Mobile not verified'

/** The label of the step this tutor stopped at, or null when every step is done.
 *  `account.emailConfirmed` false = an email signup that never confirmed. */
export function stoppedAtLabel(f: FlowFacts, account: { emailConfirmed?: boolean } = {}): string | null {
  if (account.emailConfirmed === false) return EMAIL_NOT_CONFIRMED
  if (!f.phoneVerified) return MOBILE_NOT_VERIFIED
  const k = firstMissingStep(f, NEW_FLOW_ORDER)
  return k ? STEP_LABEL[k] : null
}
