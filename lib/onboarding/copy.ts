// lib/onboarding/copy.ts
//
// The tutor onboarding flow's bilingual labels and its tagline/bio composer.
// PURE — no React, no server imports — so the composer is unit-testable and the
// labels can be read by the client and the server submit alike.
//
// Every label is English + Urdu; the flow shows both (English on top, Urdu
// under, smaller). Nothing here reads like a paragraph — labels are two or three
// words, per the "nothing is read" rule.
//
// The composer INVENTS NOTHING. Tagline and bio are built only from what the
// tutor tapped — subjects, levels, city, area, experience band. No claim about
// results, teaching style, student numbers or anything they did not choose. To
// keep the SEO pages from all carrying identical text, one of several bio
// patterns is chosen deterministically by hashing the tutor id.

export type Bi = { en: string; ur: string }

export const L = {
  // Step titles (one question per screen).
  city: { en: 'Which city?', ur: 'کون سا شہر؟' },
  area: { en: 'Which area?', ur: 'کون سا علاقہ؟' },
  subjects: { en: 'What do you teach?', ur: 'آپ کیا پڑھاتے ہیں؟' },
  level: { en: 'Which levels?', ur: 'کون سی جماعتیں؟' },
  gender: { en: 'You are', ur: 'آپ ہیں' },
  experience: { en: 'Years of experience', ur: 'تجربے کے سال' },
  fee: { en: 'Your monthly fee', ur: 'آپ کی ماہانہ فیس' },
  photo: { en: 'Add your photo', ur: 'اپنی تصویر لگائیں' },
  selfie: { en: 'Take a selfie', ur: 'سیلفی لیں' },
  review: { en: 'Your profile', ur: 'آپ کا پروفائل' },

  // The picture/selfie visibility toggle and the shared instruction (PR70).
  showAvatar: { en: 'Show my picture to parents', ur: 'اپنی تصویر والدین کو دکھائیں' },
  hiddenFromParents: { en: 'Hidden from parents', ur: 'والدین سے چھپی ہوئی' },
  pictureNote: {
    en: 'Your picture and selfie are used to check you are a real person. Only TutorMint’s verification team sees your selfie. If you don’t want your profile picture shown to parents, you can hide it — you still need to upload it.',
    ur: 'آپ کی تصویر اور سیلفی صرف اس بات کی تصدیق کے لیے لی جاتی ہیں کہ آپ ایک حقیقی فرد ہیں۔ آپ کی سیلفی صرف ٹیوٹرمنٹ کی تصدیقی ٹیم دیکھتی ہے۔ اگر آپ نہیں چاہتے کہ آپ کی پروفائل تصویر والدین کو دکھائی جائے تو آپ اسے چھپا سکتے ہیں — لیکن اسے اپ لوڈ کرنا پھر بھی ضروری ہے۔',
  },

  // Controls.
  next: { en: 'Next', ur: 'آگے' },
  back: { en: 'Back', ur: 'پیچھے' },
  skip: { en: 'Skip', ur: 'چھوڑ دیں' },
  more: { en: 'More', ur: 'مزید' },
  other: { en: 'Other', ur: 'دیگر' },
  search: { en: 'Search', ur: 'تلاش کریں' },
  looksGood: { en: 'Looks good', ur: 'ٹھیک ہے' },
  edit: { en: 'Edit', ur: 'تبدیل کریں' },
  openCamera: { en: 'Open camera', ur: 'کیمرہ کھولیں' },
  fromGallery: { en: 'Choose from gallery', ur: 'گیلری سے چنیں' },
  finish: { en: 'Finish', ur: 'مکمل کریں' },
  seeTuitions: { en: 'See tuitions', ur: 'ٹیوشنز دیکھیں' },

  // Gender tiles.
  male: { en: 'Male', ur: 'مرد' },
  female: { en: 'Female', ur: 'خاتون' },

  // Counter fragments.
  open: { en: 'tuitions open', ur: 'ٹیوشنز دستیاب' },
  acrossPakistan: { en: 'across Pakistan', ur: 'پاکستان بھر میں' },

  // Review card intro.
  tagline: { en: 'Your headline', ur: 'آپ کا عنوان' },
  bio: { en: 'About you', ur: 'آپ کے بارے میں' },
} as const

/** The experience bands (lower bound stored in experience_years). */
export const EXPERIENCE_BANDS: { label: string; years: number }[] = [
  { label: '0–1', years: 0 },
  { label: '1–3', years: 1 },
  { label: '3–5', years: 3 },
  { label: '5–10', years: 5 },
  { label: '10+', years: 10 },
]

export type OnboardingAnswers = {
  city: string | null
  /** ALL the tutor's areas (PR69). */
  areas: string[]
  subjectNames: string[]
  levelNames: string[]
  /** The tutor's job types (PR72) — drives the tagline sentence. */
  jobTypes?: string[]
  experienceBand: string | null // e.g. '3–5'
}

// Leadership job titles (PR72 §C). A title is a leadership role when it names
// one of these, so School Principal / Vice Principal / Coordinator / Head of
// Department are recognised regardless of the exact wording in the taxonomy.
const LEADERSHIP_ROLES = ['principal', 'vice principal', 'coordinator', 'head of department', 'headmaster', 'headmistress', 'director', 'dean']
export function isLeadershipRole(title: string): boolean {
  const t = title.toLowerCase()
  return LEADERSHIP_ROLES.some((k) => t.includes(k))
}

/** The lowercased online-tutor title (PR72). */
const ONLINE_TITLE = 'online tutor'

// --- natural-language helpers ------------------------------------------------

function list(items: string[], max = 3): string {
  const xs = items.slice(0, max)
  if (xs.length === 0) return ''
  if (xs.length === 1) return xs[0]
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

/** A subject list that shortens naturally: "A, B, C and 5 more subjects" (PR69). */
function subjectList(items: string[], max = 3): string {
  const xs = items.filter(Boolean)
  if (xs.length === 0) return ''
  if (xs.length <= max) return list(xs, xs.length)
  const extra = xs.length - max
  return `${xs.slice(0, max).join(', ')} and ${extra} more subject${extra === 1 ? '' : 's'}`
}

/** All the areas, then the city: "Model Town and Gulberg, Lahore" (PR69). */
function place(a: OnboardingAnswers): string {
  const areas = a.areas.filter(Boolean)
  const areaPhrase =
    areas.length <= 1 ? areas[0] ?? '' : `${areas.slice(0, -1).join(', ')} and ${areas[areas.length - 1]}`
  return [areaPhrase, a.city].filter(Boolean).join(', ')
}

function expPhrase(band: string | null): string {
  if (!band) return ''
  return band === '10+' ? 'over 10 years' : `${band} years`
}

// --- the tagline -------------------------------------------------------------

/**
 * The tagline (PR72 §C), built from the tutor's job types, levels and city.
 * Four shapes, invents nothing beyond what they chose:
 *   - leadership roles only → "I am offering my services as School Principal in Lahore."
 *   - Online Tutor only     → "I am offering Online Tutor services to Middle School and High School students."
 *   - otherwise / mixed     → "I am offering my teaching and tutoring services to
 *                              Middle School and High School students as Home Tutor and Online Tutor."
 * Lists join with commas and "and"; a missing city/level drops its clause cleanly.
 */
export function composeHeadline(a: OnboardingAnswers): string {
  const jobTypes = (a.jobTypes ?? []).filter(Boolean)
  const levels = list(a.levelNames.filter(Boolean), a.levelNames.length)
  const city = a.city?.trim() || ''

  // No job types yet — a plain, honest fallback rather than an invented role.
  if (jobTypes.length === 0) {
    return city ? `I am offering my teaching and tutoring services in ${city}.` : 'I am offering my teaching and tutoring services.'
  }

  const roles = list(jobTypes, jobTypes.length)
  const allLeadership = jobTypes.every(isLeadershipRole)
  const onlineOnly = jobTypes.length === 1 && jobTypes[0].toLowerCase() === ONLINE_TITLE

  if (allLeadership) {
    return `I am offering my services as ${roles}${city ? ` in ${city}` : ''}.`
  }
  if (onlineOnly) {
    return levels
      ? `I am offering Online Tutor services to ${levels} students.`
      : 'I am offering Online Tutor services.'
  }
  // Otherwise (teaching, or leadership mixed with teaching): list every role.
  return levels
    ? `I am offering my teaching and tutoring services to ${levels} students as ${roles}.`
    : `I am offering my teaching and tutoring services as ${roles}.`
}

// --- the bio -----------------------------------------------------------------

/** A small, stable string hash → non-negative int, for deterministic selection. */
function hash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Two or three short sentences, built only from the tutor's own answers, with
 * one of five patterns chosen by hashing their id so profiles do not all read
 * the same. Empty facts are dropped rather than voiced.
 */
export function composeBio(a: OnboardingAnswers, seed: string): string {
  const subjects = subjectList(a.subjectNames)
  const levels = list(a.levelNames)
  const where = place(a)
  const exp = expPhrase(a.experienceBand)
  const subjectsOr = subjects || 'a range of subjects'

  const patterns: string[][] = [
    [
      `I teach ${subjectsOr}${where ? ` in ${where}` : ''}.`,
      levels ? `I take students at ${levels}.` : '',
      exp ? `I have ${exp} of teaching experience.` : '',
    ],
    [
      exp ? `With ${exp} of experience, I help students with ${subjectsOr}.` : `I help students with ${subjectsOr}.`,
      levels ? `I cover ${levels}.` : '',
      where ? `I teach around ${where}.` : '',
    ],
    [
      `Tutoring ${subjectsOr}${levels ? ` for ${levels}` : ''}${where ? `, based in ${where}` : ''}.`,
      exp ? `${exp[0].toUpperCase()}${exp.slice(1)} of teaching experience.` : '',
    ],
    [
      `${subjectsOr} tutor${where ? ` in ${where}` : ''}.`,
      levels ? `Teaching ${levels}.` : '',
      exp ? `${exp[0].toUpperCase()}${exp.slice(1)} in the classroom.` : '',
    ],
    [
      `I offer tuition in ${subjectsOr}${where ? ` across ${where}` : ''}.`,
      levels ? `Students at ${levels} are welcome.` : '',
      exp ? `Backed by ${exp} of experience.` : '',
    ],
  ]

  const chosen = patterns[hash(seed) % patterns.length]
  return chosen
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ')
}
