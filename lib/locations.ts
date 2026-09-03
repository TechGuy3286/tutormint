// lib/locations.ts
//
// The city and area lists the browse filters offer. Lifted out of the old
// client-only browse page so the server page, the filter bar and (later) job
// posting all offer the same options and store the same spellings -- ranking
// compares city and area with lower(), and "DHA Phase 5" vs "dha phase 5" is
// survivable, but "Islamabad" vs "Isb" is not.
//
// Free text is still accepted for `area` in the URL: a tutor may live in a
// neighbourhood nobody listed, and area only ranks, it never filters.

export const CITIES = [
  'Lahore',
  'Karachi',
  'Islamabad',
  'Rawalpindi',
  'Faisalabad',
  'Multan',
  'Peshawar',
  'Quetta',
  'Sialkot',
  'Gujranwala',
] as const

export const CITY_AREAS: Record<string, string[]> = {
  Lahore: [
    'Gulberg',
    'DHA Phase 5',
    'DHA',
    'Bahria Town',
    'Model Town',
    'Johar Town',
    'Wapda Town',
    'Faisal Town',
    'Cantt',
    'Garden Town',
    'Shadman',
  ],
  Karachi: ['Clifton', 'PECHS', 'Gulshan-e-Iqbal', 'Defence', 'North Nazimabad', 'Korangi'],
  Islamabad: ['F-6', 'F-7', 'F-8', 'G-8', 'G-9', 'H-8', 'Blue Area', 'I-8'],
  Rawalpindi: ['Saddar', 'Satellite Town', 'Bahria Town Rawalpindi', 'Chaklala'],
  Faisalabad: ["People's Colony", 'D-Ground', 'Madina Town', 'Sargodha Road'],
  Multan: ['Gulgasht Colony', 'Bosan Road', 'Shah Rukn-e-Alam', 'Mumtazabad'],
  Peshawar: ['University Town', 'Hayatabad', 'Saddar', 'Dabgari Gardens'],
  Quetta: ['Jinnah Town', 'Model Town', 'Shahbaz Town', 'Satellite Town'],
  Sialkot: ['Model Town', 'Paris Road', 'Cantt', 'Defence Road'],
  Gujranwala: ['Model Town', 'Peoples Colony', 'Satellite Town', 'Civil Lines'],
}

/**
 * The canonical teaching-mode values, and the only ones the database accepts
 * (migration 35 puts a CHECK constraint on all three columns that hold one).
 *
 * VALUES ONLY. The words a person reads come from `teachingMode()` in
 * lib/display.ts, which is the single place a stored value becomes English —
 * so a dropdown, a job card and a tutor profile cannot drift into calling the
 * same value three different things.
 */
export const TEACHING_MODES = ['in_person', 'online', 'both'] as const

export type TeachingMode = (typeof TEACHING_MODES)[number]

/**
 * A set of ticked modes, reduced to the one value the column may hold.
 *
 * Ticking both boxes is 'both'; ticking neither is 'both' as well, because a
 * tutor who has told us nothing should not be excluded from every mode filter
 * -- which is the exact failure migration 35 was written to repair on the jobs
 * side.
 */
/**
 * A mode from a URL, reduced to the canonical value or null.
 *
 * Links with `?mode=Physical` are already out in the world -- shared, pasted
 * into WhatsApp, sitting in someone's history -- and after migration 35 an
 * exact-match filter on that spelling returns nothing at all. A search that
 * silently finds zero results is worse than one that ignores the filter, so
 * the retired spellings are translated here rather than dropped.
 */
export function parseMode(raw: string | null | undefined): TeachingMode | null {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'in_person':
    case 'in-person':
    case 'physical':
    case 'school':
    case 'onsite':
    case 'on_site':
      return 'in_person'
    case 'online':
    case 'remote':
      return 'online'
    case 'both':
    case 'either':
    case 'any':
      return 'both'
    default:
      return null
  }
}

export function canonicalMode(selected: readonly string[]): TeachingMode {
  const has = (m: TeachingMode) => selected.includes(m)
  if (has('in_person') && has('online')) return 'both'
  if (has('online')) return 'online'
  if (has('in_person')) return 'in_person'
  return 'both'
}

export const GENDERS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
] as const
