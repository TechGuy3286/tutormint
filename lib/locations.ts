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

/** Matches tutor_profiles.teaching_mode, which stores capitalised values. */
export const TEACHING_MODES = ['Physical', 'Online', 'Both'] as const

export const GENDERS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
] as const
