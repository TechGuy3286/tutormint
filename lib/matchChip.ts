// lib/matchChip.ts
//
// Whether a tuition matches a tutor, in one place so the dashboard strip, the
// matching-job notification and the browse card all decide it the same way.
//
// JOB TYPE ALIGNS THE TWO SIDES (owner, 10–11 Sep 2026). Job Type is now a set
// of 19 job titles (migration 77), stored verbatim; a job carries one, a tutor
// offers a set. A job matches a tutor when the tutor's set CONTAINS the job's
// title. Beyond that, location:
//   * "Online Tutor" : city-agnostic — an online tutor takes online jobs anywhere.
//   * every other title : location-bound — same city, because a home visit or a
//     school post happens in a place.
// The stored column is still `teaching_mode` (see the CLAUDE.md decision); its
// values are now the title text, e.g. 'Home Tutor' | 'Online Tutor' | 'O Levels Teacher'.

import { ONLINE_JOB_TITLE, isOnlineTitle } from '@/lib/jobTitlesCore'

export type MatchVisibility = 'same_city' | 'online' | 'exclude'

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

/** Whether a Job Type is the city-agnostic online title ("Online Tutor"). Kept
 *  under this name for the callers that already import it. */
export function isOnlineType(jobType: string | null | undefined): boolean {
  return isOnlineTitle(jobType)
}

export { ONLINE_JOB_TITLE }

/**
 * How a tuition relates to a tutor.
 *
 * A tutor now offers a SET of Job Types (owner, 10 Sep 2026), so the alignment
 * is CONTAINMENT: the job matches when the tutor's set includes the job's type.
 *
 *  - exclude   : the tutor does not offer this Job Type; a home/school job in a
 *                different city; OR ANY in-person job when the tutor has no city.
 *  - online    : an online (city-agnostic) job the tutor offers, when the two
 *                cities differ or the tutor has no city → matched, with the chip.
 *  - same_city : offered and same city, or the JOB's city is unknown (we cannot
 *                claim a mismatch we cannot see), included with no chip.
 *
 * NO TUTOR CITY (owner PR3 §2): a tutor with no `tutor_profiles.city` sees NO
 * in-person tuitions as matching — only online tuitions match (on subject). A
 * home/school job cannot be placed without knowing where the tutor is, so it is
 * excluded rather than shown as a match. (The full /browse/tuitions list is
 * unaffected — it shows every job regardless; matchVisibility only drives the
 * curated match surfaces and the "suitable for online" chip.)
 *
 * Empty/undefined tutorTypes is "no constraint" rather than excluding everything
 * — a tutor mid-setup with no Job Type yet still sees matches.
 */
export function matchVisibility(
  jobType: string | null | undefined,
  jobCity: string | null | undefined,
  tutorTypes: readonly string[] | null | undefined,
  tutorCity: string | null | undefined,
): MatchVisibility {
  const jt = norm(jobType)
  const tt = (tutorTypes ?? []).map(norm).filter(Boolean)
  if (tt.length > 0 && jt && !tt.includes(jt)) return 'exclude'

  const jc = norm(jobCity)
  const tc = norm(tutorCity)
  const online = isOnlineTitle(jobType)

  // No tutor city → in-person excluded, online only.
  if (!tc) return online ? 'online' : 'exclude'

  if (!jc || jc === tc) return 'same_city'

  return online ? 'online' : 'exclude'
}

/**
 * The chip predicate for surfaces that show every job regardless (the browse
 * board): the chip appears when a signed-in tutor who offers online is viewing a
 * cross-city online job they could still take. It never HIDES a job.
 */
export function showsOnlineChip(
  jobType: string | null | undefined,
  jobCity: string | null | undefined,
  tutorTypes: readonly string[] | null | undefined,
  tutorCity: string | null | undefined,
): boolean {
  return matchVisibility(jobType, jobCity, tutorTypes, tutorCity) === 'online'
}
