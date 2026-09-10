// lib/genderPref.ts
//
// A tuition's optional preferred tutor gender (owner, 11 Sep 2026). Pure, so the
// Apply endpoint, the card, the detail page and the tests share one rule.
//
// The job stays visible to everyone; only Apply is gated. A tutor whose profile
// gender does not match the preference cannot apply — but an UNSET tutor gender
// is treated as "no check", never as a mismatch (owner). "No preference" (null)
// never blocks anyone.

export type GenderPref = 'male' | 'female' | 'trans'

/** The options a post-a-tuition form offers. '' is "No preference" (stored NULL). */
export const GENDER_PREFS: { value: '' | GenderPref; label: string }[] = [
  { value: '', label: 'No preference' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'trans', label: 'Trans' },
]

/** Normalise a form/request value to a stored preference or null. */
export function normaliseGenderPref(value: string | null | undefined): GenderPref | null {
  const v = (value ?? '').trim().toLowerCase()
  return v === 'male' || v === 'female' || v === 'trans' ? v : null
}

/** The word shown in the sentence: "female" / "male" / "trans". */
export function genderPrefWord(pref: string | null | undefined): string | null {
  const p = normaliseGenderPref(pref)
  return p // already the lowercase word; null when no preference
}

/**
 * The sentence shown on the card and detail page, and used as the Apply-refusal
 * reason: "Parent is looking for a female tutor." Null when there is no
 * preference (nothing to show).
 */
export function genderPrefSentence(pref: string | null | undefined): string | null {
  const p = normaliseGenderPref(pref)
  if (!p) return null
  return `Parent is looking for a ${p} tutor.`
}

/**
 * Does this tutor's gender FAIL the job's preference? True only when there is a
 * preference AND the tutor has a set gender AND it differs. An unset tutor
 * gender (null/'') never mismatches — they may apply to anything.
 */
export function genderApplyBlocked(
  pref: string | null | undefined,
  tutorGender: string | null | undefined,
): boolean {
  const p = normaliseGenderPref(pref)
  if (!p) return false
  const g = (tutorGender ?? '').trim().toLowerCase()
  if (!g) return false
  return g !== p
}
