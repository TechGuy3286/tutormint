// lib/experienceEditCore.ts
//
// Experience on Edit Profile (owner, 4 Nov 2026 hotfix): editable at any time,
// with the same choices as onboarding (lib/onboarding/copy EXPERIENCE_BANDS —
// the band's lower bound is stored in tutor_profiles.experience_years). PURE, so
// the card, the editor and the test read one rule.

import { EXPERIENCE_BANDS } from '@/lib/onboarding/copy'
import { experienceLabel } from '@/lib/experienceLabel'

/** The chips, in onboarding order, with onboarding's own words. */
export const EXPERIENCE_CHOICES: { years: number; label: string }[] = EXPERIENCE_BANDS.map((b) => ({
  years: b.years,
  label: b.years === 0 ? 'New to teaching' : `${b.label} years`,
}))

/** A stored value is a valid choice only when it is one of the bands. */
export function isExperienceChoice(years: unknown): years is number {
  return typeof years === 'number' && EXPERIENCE_CHOICES.some((c) => c.years === years)
}

/** What /api/profile/save receives for an experience change. */
export function experienceSavePayload(years: number): { tutorProfile: { experience_years: number } } {
  if (!isExperienceChoice(years)) throw new Error('Choose your years of experience.')
  return { tutorProfile: { experience_years: years } }
}

/** "New to teaching" (0) is an answer, as in onboarding; only null is missing. */
export function experienceAnswered(years: number | null | undefined): boolean {
  return typeof years === 'number' && years >= 0
}

/** The collapsed card's summary line. */
export function experienceSummary(years: number | null | undefined): string {
  return experienceAnswered(years) ? experienceLabel(years).en : ''
}
