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
 * A tutor now offers a SET of Job Types (owner, 10 Sep 2026), so the alignment
 * is CONTAINMENT: the job matches when the tutor's set includes the job's type.
 *
 *  - exclude   : the tutor does not offer this Job Type, OR a home/school job in
 *                a different city.
 *  - online    : the tutor offers online and the (online) job is in a different
 *                city → matched, show the chip that explains the distance.
 *  - same_city : offered and same city, or either city unknown (we cannot claim
 *                a mismatch we cannot see, so it is included with no chip).
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
  if (!jc || !tc || jc === tc) return 'same_city'

  return jt === 'online' ? 'online' : 'exclude'
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
