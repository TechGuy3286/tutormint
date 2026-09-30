// lib/experienceLabel.ts
//
// The tutor's REAL teaching experience for the Browse card and public profile
// (PR94 Part 1), from onboarding step 9 — `tutor_profiles.experience_years`, the
// lower bound of the band the tutor picked (lib/onboarding/copy EXPERIENCE_BANDS:
// 0–1→0, 1–3→1, 3–5→3, 5–10→5, 10+→10). It is NOT account age.
//
// A tutor who is new to teaching (or has no experience on file) reads "New to
// teaching"; everyone else reads their band as a range ("3–5 years", "10+
// years"). English with an Urdu line underneath (the surfaces render both).
// PURE — no imports beyond the shared bands — so the card, the profile and any
// test read one rule.

import { EXPERIENCE_BANDS } from '@/lib/onboarding/copy'

export type ExperienceLabel = { en: string; ur: string }

export function experienceLabel(years: number | null | undefined): ExperienceLabel {
  const y = years ?? 0
  if (y <= 0) return { en: 'New to teaching', ur: 'تدریس میں نئے' }

  // Show the band the tutor chose as a range, not just its lower bound.
  const band = EXPERIENCE_BANDS.find((b) => b.years === y)
  if (band) {
    // "10+" → "10+ years"; "3–5" → "3–5 years".
    return { en: `${band.label} years`, ur: `${band.label} سال کا تدریسی تجربہ` }
  }
  // A value that matches no band (e.g. a bulk-imported number) — show it plainly.
  return {
    en: `${y} year${y === 1 ? '' : 's'}`,
    ur: `${y} سال کا تدریسی تجربہ`,
  }
}
