// lib/matchChip.ts
//
// Whether a tuition matches a tutor, in one place so the dashboard strip, the
// matching-job notification and the browse card all decide it the same way.
//
// JOB TYPE ALIGNS THE TWO SIDES (owner, 10 Sep 2026). The three Job Types are
// mutually exclusive — home / online / school — so a job matches a tutor only
// when their Job Types are the same. Beyond that, location:
//   * online : city-agnostic — an online tutor takes online jobs anywhere.
//   * home / school : location-bound — same city, because a home visit or a
//     school post happens in a place.
// The stored column is still `teaching_mode` (see the CLAUDE.md decision); its
// values are 'home' | 'online' | 'school'.

export type MatchVisibility = 'same_city' | 'online' | 'exclude'

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

/** Whether a Job Type is the city-agnostic online one. */
export function isOnlineType(jobType: string | null | undefined): boolean {
  return norm(jobType) === 'online'
}

/**
 * How a tuition relates to a tutor.
 *
 *  - exclude   : the Job Types differ (a home job is not for an online tutor),
 *                OR a home/school job in a different city.
 *  - online    : same (online) Job Type, different city → matched, show the chip
 *                that explains the distance.
 *  - same_city : same Job Type and same city, or either city unknown (we cannot
 *                claim a mismatch we cannot see, so it is included with no chip).
 *
 * A null tutorType is treated as "no constraint" rather than excluding
 * everything — a tutor mid-setup with no Job Type yet still sees matches.
 */
export function matchVisibility(
  jobType: string | null | undefined,
  jobCity: string | null | undefined,
  tutorType: string | null | undefined,
  tutorCity: string | null | undefined,
): MatchVisibility {
  const jt = norm(jobType)
  const tt = norm(tutorType)
  if (tt && jt && tt !== jt) return 'exclude'

  const jc = norm(jobCity)
  const tc = norm(tutorCity)
  if (!jc || !tc || jc === tc) return 'same_city'

  return jt === 'online' ? 'online' : 'exclude'
}

/**
 * The chip predicate for surfaces that show every job regardless (the browse
 * board): the chip appears when a signed-in online tutor is viewing a
 * cross-city online job they could still take. It never HIDES a job.
 */
export function showsOnlineChip(
  jobType: string | null | undefined,
  jobCity: string | null | undefined,
  tutorType: string | null | undefined,
  tutorCity: string | null | undefined,
): boolean {
  return matchVisibility(jobType, jobCity, tutorType, tutorCity) === 'online'
}
