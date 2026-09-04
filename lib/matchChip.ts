// lib/matchChip.ts
//
// The cross-city "Suitable for online" rule, in one place so the dashboard
// strip, the matching-job notification and the browse card all decide it the
// same way.
//
// A tuition in a DIFFERENT city from the tutor is a match ONLY if it can be
// taught online. When it is, the card carries a "Suitable for online" chip so
// the distance is explained rather than confusing. When the tuition is
// in-person only and the city differs, it is not a match at all — a curated
// match surface must not show it, because a card that can carry no honest chip
// should not be there.
//
// teaching_mode is canonical: 'in_person' | 'online' | 'both'.

export type MatchVisibility = 'same_city' | 'online' | 'exclude'

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

/** Whether a job's mode allows online teaching. */
export function allowsOnline(mode: string | null | undefined): boolean {
  return mode === 'online' || mode === 'both'
}

/**
 * How a tuition relates to a tutor's location.
 *
 *  - same_city : same city (or either city unknown — we cannot claim a
 *                mismatch we cannot see, so it is included with no chip)
 *  - online    : different city, teachable online → matched, show the chip
 *  - exclude   : different city, in-person only → not a match, do not show
 */
export function matchVisibility(
  jobCity: string | null | undefined,
  jobMode: string | null | undefined,
  tutorCity: string | null | undefined,
): MatchVisibility {
  const jc = norm(jobCity)
  const tc = norm(tutorCity)
  if (!jc || !tc || jc === tc) return 'same_city'
  return allowsOnline(jobMode) ? 'online' : 'exclude'
}

/**
 * The chip predicate for surfaces that show every job regardless (the browse
 * board): the chip appears when a signed-in tutor is viewing a cross-city job
 * they could still take online. It never HIDES a job — browse shows the whole
 * board to everyone, including guests, whose city is unknown (no chip).
 */
export function showsOnlineChip(
  jobCity: string | null | undefined,
  jobMode: string | null | undefined,
  tutorCity: string | null | undefined,
): boolean {
  return matchVisibility(jobCity, jobMode, tutorCity) === 'online'
}
