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

/** The label of the step this tutor stopped at, or null when every step is done. */
export function stoppedAtLabel(f: FlowFacts): string | null {
  const k = firstMissingStep(f, NEW_FLOW_ORDER)
  return k ? STEP_LABEL[k] : null
}
