// lib/covers/scene.ts
//
// WHAT a blog cover's picture shows (owner, 14 Oct 2026), decided from the
// post's subject, level, city and cluster. Pure — no imports beyond the level
// rule — so the composer, the image prompt, the alt text and the tests all read
// the same answer.
//
//   Islamiat / Quran      study of the Quran at a table
//   Physics / Science     a simple experiment
//   Maths                 working on a notebook
//   English / Urdu        reading together
//   tutor-career posts    a tutor preparing a lesson
//   city guides           a calm, recognisable local street or building,
//                         without signage
//   online tutoring       a laptop video lesson at home
//
// The scene never contains text: the title, the logo, the brand line and the
// tagline are put on top by code (lib/covers/compose.tsx).

import { groupOfText } from '@/lib/blogRelevanceCore'

export type SceneKind = 'online' | 'tutor-prep' | 'quran' | 'experiment' | 'maths' | 'reading' | 'computer' | 'city' | 'exam' | 'study'

export type SceneInput = {
  title: string
  cluster: string
  city?: string | null
  subject?: string | null
  audience?: 'parents' | 'tutors' | 'both'
  slug?: string | null
}

export type CoverScene = {
  kind: SceneKind
  /** The scene in one phrase, for the image prompt ("a tutor and a student …"). */
  line: string
  /** True only when the topic itself is religious (Islamiat, Quran). */
  religious: boolean
  /** The post's level group ("primary", "o-level"…), or ''. */
  level: string
  /** The age of the student in the picture, in words. */
  student: string
  /** Whether the tutor in the picture is a woman or a man — alternates across
   *  posts (by the post's slug or title) so covers show both. */
  tutor: 'female' | 'male'
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

const STUDENT_BY_LEVEL: Record<string, string> = {
  kg: 'a young child of about five',
  primary: 'a child of about eight',
  middle: 'a child of about twelve',
  matric: 'a teenager of about fifteen',
  igcse: 'a teenager of about fifteen',
  'o-level': 'a teenager of about sixteen',
  'a-level': 'a student of about eighteen',
  fsc: 'a student of about seventeen',
  fa: 'a student of about seventeen',
  ics: 'a student of about seventeen',
  icom: 'a student of about seventeen',
  bs: 'a university student',
  ms: 'a university student',
}

/** The scene a post's cover shows. Deterministic for a post. */
export function sceneFor(input: SceneInput): CoverScene {
  const subject = (input.subject ?? '').toLowerCase()
  const text = `${subject} ${input.title}`.toLowerCase()
  const city = (input.city ?? '').trim()
  const level = groupOfText(input.subject) || groupOfText(input.title)
  const student = STUDENT_BY_LEVEL[level] ?? 'a school-age student'
  const tutor = hash(input.slug || input.title || 'x') % 2 === 0 ? 'female' : 'male'
  const who = `a ${tutor} tutor and ${student}`
  const base = { level, student, tutor } as const

  if (/\bonline\b|\bzoom\b|video (?:lesson|class)/.test(text)) {
    return { ...base, kind: 'online', religious: false, line: `${student} at home having a video lesson on a laptop, the tutor visible on the screen as a simple figure` }
  }
  if (input.cluster === 'tutor-career') {
    return { ...base, kind: 'tutor-prep', religious: false, line: `a ${tutor} tutor preparing a lesson at a desk with books and a notebook` }
  }
  if (/quran|islam|nazra|tajweed|hifz/.test(text)) {
    return { ...base, kind: 'quran', religious: true, line: `${who} studying the Quran together at a table, the book resting on a wooden stand` }
  }
  if (/physics|chem|bio|botany|zoology|science/.test(text) && !/computer science/.test(text)) {
    return { ...base, kind: 'experiment', religious: false, line: `${who} doing a simple, safe science experiment at a table` }
  }
  if (/math|algebra|calculus|geometry|stat/.test(text)) {
    return { ...base, kind: 'maths', religious: false, line: `${who} working through a problem in a notebook, with a ruler and a pencil on the table` }
  }
  if (/comput|\bict\b|programming|coding/.test(text)) {
    return { ...base, kind: 'computer', religious: false, line: `${who} working together at a computer` }
  }
  if (/english|urdu|literature|language|reading|writing/.test(text)) {
    return { ...base, kind: 'reading', religious: false, line: `${who} reading a book together at a table` }
  }
  if (input.cluster === 'city-guides') {
    return {
      ...base,
      kind: 'city',
      religious: false,
      line: `a calm street scene in ${city || 'a Pakistani city'} with a recognisable local building in the background, with no signs, shop names or lettering`,
    }
  }
  if (input.cluster === 'boards-exams') {
    return { ...base, kind: 'exam', religious: false, line: `${student} revising at a desk with notebooks and a desk lamp, a tutor helping` }
  }
  return { ...base, kind: 'study', religious: false, line: `${who} studying together at a table at home` }
}

/** The library motif that stands for a scene when the post names no subject. */
export const SCENE_MOTIF: Record<SceneKind, string> = {
  online: 'online',
  'tutor-prep': 'book',
  quran: 'quran',
  experiment: 'science',
  maths: 'maths',
  reading: 'english',
  computer: 'computer',
  city: 'pin',
  exam: 'book',
  study: 'book',
}
