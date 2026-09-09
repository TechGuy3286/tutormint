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
