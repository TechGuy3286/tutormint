// scripts/cvFixtures.ts — sample CV profiles for the tests and the sample PDFs.
// Invented people only: no real tutor's name, phone or email. The phone
// numbers are the 0300 1234567 test pattern; emails are @example.com.

import type { CvRaw } from '../lib/cv/model'

export const BASE = 'https://proj.supabase.co'

export function cvRaw(over: Partial<CvRaw> = {}): CvRaw {
  return {
    fullName: 'Ali Raza',
    avatarUrl: null,
    photoHidden: false,
    gender: 'male',
    city: 'Lahore',
    area: 'DHA Phase 5',
    areas: [{ area: 'DHA Phase 5', city: 'Lahore' }],
    headline: 'Experienced tutor',
    bio: 'I teach with patience. I have 5–10 years of teaching experience.',
    subjectGroups: [{ level: 'O Levels', subjects: ['Physics', 'Mathematics'] }],
    degrees: ['BSc Physics — LUMS'],
    experienceYears: 5,
    feeMinPkr: 8000,
    feeMaxPkr: 15000,
    teachingMode: 'Home Tutor',
    jobTypes: ['Home Tutor'],
    languages: [],
    phone: '923001234567',
    whatsapp: '923001234567',
    email: 'ali@example.com',
    slug: 'ali-raza',
    profileUrl: 'https://www.tutormint.org/tutor/ali-raza',
    completion: 100,
    verified: true,
    accent: null,
    ...over,
  }
}

const SUBJECTS_20 = [
  'Mathematics', 'Physics', 'Chemistry', 'Biology', 'Computer Science', 'ICT', 'English', 'Urdu',
  'Islamiat', 'Pakistan Studies', 'Economics', 'Accounting', 'Business Studies', 'Statistics',
  'General Science', 'Geography', 'History', 'Sociology', 'Psychology', 'Further Mathematics',
]

/** The hardest profile: very long name, 20 subjects, a long About, many areas. */
export function heavyRaw(over: Partial<CvRaw> = {}): CvRaw {
  return cvRaw({
    fullName: 'Muhammad Abdul Rehman Siddiqui Chaudhry Niazi Khan',
    subjectGroups: [
      { level: 'Grade 6', subjects: SUBJECTS_20.slice(0, 7) },
      { level: 'Grade 7', subjects: SUBJECTS_20.slice(0, 7) },
      { level: 'Grade 8', subjects: SUBJECTS_20.slice(0, 7) },
      { level: 'Grade 9 - Science', subjects: ['Computer Science', 'ICT', 'Physics', 'Chemistry', 'Mathematics'] },
      { level: 'Grade 10 - Science', subjects: ['Computer Science', 'ICT', 'Physics', 'Chemistry', 'Mathematics'] },
      { level: 'Grade 9 - Arts', subjects: ['Computer Science', 'Economics', 'Islamiat'] },
      { level: 'Grade 10 - Arts', subjects: ['Computer Science', 'Economics', 'Islamiat'] },
      { level: 'O Levels', subjects: SUBJECTS_20.slice(7, 16) },
      { level: 'AS & A Levels', subjects: SUBJECTS_20.slice(10, 20) },
      { level: 'FSC Part I & Part II', subjects: ['Physics', 'Chemistry', 'Biology', 'Mathematics'] },
      { level: 'FA ( Part I & Part II)', subjects: ['Economics', 'Psychology', 'Sociology'] },
      { level: 'Semester 1 - 8', subjects: ['Statistics', 'Accounting'] },
    ],
    bio:
      'I am a dedicated teacher who has spent many years helping students understand difficult ideas in simple steps. ' +
      'I have 5–10 years of teaching experience across schools, academies and home tuition. '.repeat(3) +
      'My lessons start from what the student already knows, and build slowly with lots of practice, past papers and short tests every week. ' +
      'Parents receive a short update after every month so they always know where their child stands and what we will work on next. '.repeat(4),
    areas: [
      'DHA Phase 5', 'Bahria Town', 'Cantt', 'Gulberg', 'Model Town', 'Johar Town', 'Garden Town',
      'Faisal Town', 'Wapda Town', 'Valencia', 'Township', 'Iqbal Town',
    ].map((area) => ({ area, city: 'Lahore' })),
    degrees: [
      'BS COMPUTER SCIENCE — UNIVERSITY OF THE PUNJAB (2015)',
      'MSc Mathematics, Government College University Lahore (2018)',
      'M.PHIL EDUCATION — UNIVERSITY OF EDUCATION LAHORE (2021)',
      'B.Ed, Allama Iqbal Open University (2019)',
      'Diploma in Teaching English as a Foreign Language from a long institute name here',
      'Certificate in Online Teaching',
    ],
    jobTypes: ['Home Tutor', 'Online Tutor', 'O Levels Teacher'],
    ...over,
  })
}

/** A sparse profile: name, city and one subject. */
export function sparseRaw(over: Partial<CvRaw> = {}): CvRaw {
  return cvRaw({
    fullName: 'Sana Iqbal',
    gender: 'female',
    area: null,
    areas: [],
    bio: null,
    headline: null,
    subjectGroups: [{ level: 'Grade 3', subjects: ['English'] }],
    degrees: [],
    experienceYears: null,
    feeMinPkr: null,
    feeMaxPkr: null,
    jobTypes: ['Home Tutor'],
    phone: null,
    whatsapp: null,
    email: null,
    verified: false,
    ...over,
  })
}
