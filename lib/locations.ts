// lib/locations.ts
//
// The Job Type and gender VALUE sets. The city/area lists moved to the database
// (migration 73) — they are DATA now, not a hardcoded array: read them through
// lib/cityAreas.ts (client) or lib/locationsAdmin.ts (server/admin review).
// Adding a city or area is an INSERT, not a code change. This file keeps only
// the small fixed enumerations that are genuinely code (Job Type, gender), and
// stays free of any Supabase/React import so the server can import parseMode.

/**
 * The canonical Job Type values, and the only ones the database accepts
 * (migration 68 puts a CHECK constraint on the two columns that hold one).
 * They are mutually exclusive — there is no "both" (owner, 10 Sep 2026).
 *
 * VALUES ONLY. The words a person reads come from `jobType()` in lib/display.ts
 * (Home Tuition / Online Tuition / School Job), the single place a stored value
 * becomes English — so a dropdown, a job card and a tutor profile cannot drift
 * into calling the same value three different things. The physical column is
 * still named `teaching_mode`; see the CLAUDE.md decision for why.
 */
export const JOB_TYPES = ['home', 'online', 'school'] as const

export type JobType = (typeof JOB_TYPES)[number]

/**
 * A Job Type from a URL or a stored value, reduced to the canonical value or
 * null.
 *
 * Translates the retired spellings rather than dropping them: `?mode=Physical`
 * and `?mode=both` links are already out in the world, and after migration 68
 * an exact-match filter on those returns nothing. `both` maps to `home` (the
 * value it became), and the old in-person spellings map to `home` too.
 */
export function parseMode(raw: string | null | undefined): JobType | null {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'home':
    case 'home_tuition':
    case 'in_person':
    case 'in-person':
    case 'physical':
    case 'onsite':
    case 'on_site':
    case 'both':
    case 'either':
    case 'any':
      return 'home'
    case 'online':
    case 'online_tuition':
    case 'remote':
      return 'online'
    case 'school':
    case 'school_job':
      return 'school'
    default:
      return null
  }
}

export const GENDERS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
] as const
