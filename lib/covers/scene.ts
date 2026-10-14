// lib/covers/scene.ts
//
// WHAT a blog cover's picture shows (owner, 14 Oct 2026), decided from the
// post's subject, level, audience, city and cluster. Pure — no database, no
// server-only import — so the composer, the image prompt, the alt text and the
// tests all read the same answer.
//
//   Islamiat / Quran      study of the Quran at a table (the ONLY religious scene)
//   Physics / Science     a simple experiment
//   Maths                 working in a notebook
//   English / Urdu        reading together
//   tutor-career posts    a tutor alone, preparing a lesson
//   city guides           a calm local street with a recognisable building
//   online tutoring       a laptop video lesson at home
//   exams                 revising at a desk
//
// The scene never contains text: the title, the monogram, the brand line and
// the tagline are put on top by code (lib/covers/compose.tsx).

import { groupsOfText, subjectOfText } from '@/lib/blogRelevanceCore'
import { subjectTitleName } from '@/lib/contentQueue/topics'

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
  /** The scene in one phrase: who, doing what, where. */
  line: string
  /** True only when the topic itself is religious (Islamiat, Quran). */
  religious: boolean
  /** The post's level group ("primary", "o-level"…), or ''. */
  level: string
  /** The plain lesson name ("Matric English", "O and A Level", "FA Maths"), or ''. */
  lesson: string
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

/** The words a prompt or title uses for a level group (lib/contentQueue/topics levelGroup labels). */
const LEVEL_WORD: Record<string, string> = {
  kg: 'Play Group and KG',
  primary: 'Primary',
  middle: 'Middle',
  matric: 'Matric',
  fsc: 'FSc',
  fa: 'FA',
  ics: 'ICS',
  icom: 'I.Com',
  igcse: 'IGCSE',
  'o-level': 'O Level',
  'a-level': 'A Level',
  bs: 'BS',
  ms: 'MS / MPhil',
}

const ACRONYMS = new Set(['ict', 'gat', 'sat', 'ielts', 'mdcat', 'ecat', 'nts', 'gre', 'gmat', 'it'])

/** "english" → "English", "computer science" → "Computer Science", "ict" → "ICT". */
function titleWords(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

/** The plain level words for a post: "Matric", "O and A Level", or ''. */
export function levelWords(groups: string[]): string {
  if (groups.includes('o-level') && groups.includes('a-level')) return 'O and A Level'
  return groups.map((g) => LEVEL_WORD[g] ?? '').filter(Boolean)[0] ?? ''
}

/** The plain subject a post's Subject field names, without its level words and
 *  raw labels: "Grade 9 & 10 - Science English" → "English"; "Mathematics" → "Maths". */
export function plainSubject(subject: string | null | undefined): string {
  const rest = subjectOfText(subject)
  if (!rest) return ''
  return subjectTitleName(titleWords(rest))
}

/** The scene a post's cover shows. Deterministic for a post. */
export function sceneFor(input: SceneInput): CoverScene {
  // Read the PLAIN subject, never the raw label: 'Grade 9 & 10 - Science
  // English' is an English post, not a science one. The title is read only
  // when the post has no subject.
  const plain = subjectOfText(input.subject)
  const text = (plain || input.title).toLowerCase()
  const city = (input.city ?? '').trim()
  const fromSubject = groupsOfText(input.subject)
  const groups = fromSubject.length > 0 ? fromSubject : groupsOfText(input.title)
  const level = groups[0] ?? ''
  const subjectName = plainSubject(input.subject)
  const lesson = [levelWords(groups), subjectName].filter(Boolean).join(' ')
  const student = STUDENT_BY_LEVEL[level] ?? 'a school-age student'
  const tutor = hash(input.slug || input.title || 'x') % 2 === 0 ? 'female' : 'male'
  // A post for parents of a young child shows the parent too.
  const young = level === 'kg' || level === 'primary' || level === 'middle' || level === ''
  const parentNear = input.audience === 'parents' && young ? ', with a parent sitting nearby' : ''
  const who = `a ${tutor} tutor and ${student}`
  const table = 'at a home study table'
  const base = { level, lesson, student, tutor } as const
  const scene = (kind: SceneKind, line: string, religious = false): CoverScene => ({ ...base, kind, line, religious })

  // How the lesson is given can be in the title ("Online O Level Physics tutoring").
  if (/\bonline\b|\bzoom\b|video (?:lesson|class)/.test(`${plain} ${input.title}`.toLowerCase())) {
    return scene('online', `${student} at a home desk having a video lesson on a laptop, a ${tutor} tutor shown on the screen`)
  }
  if (input.cluster === 'tutor-career') {
    return scene('tutor-prep', `a ${tutor} tutor alone at a home desk, preparing a lesson with books and a notebook`)
  }
  if (/quran|islam|nazra|tajweed|hifz/.test(text)) {
    return scene('quran', `${who} studying the Quran together ${table}, the Quran resting on a wooden stand${parentNear}`, true)
  }
  if (/physics|chem|bio|botany|zoology|science/.test(text) && !/computer science/.test(text)) {
    return scene('experiment', `${who} doing a simple, safe science experiment with a flask and test tubes ${table}${parentNear}`)
  }
  if (/math|algebra|calculus|geometry|stat/.test(text)) {
    return scene('maths', `${who} working through a maths problem in a notebook ${table}, a ruler and pencil beside them${parentNear}`)
  }
  if (/comput|\bict\b|programming|coding/.test(text)) {
    return scene('computer', `${who} working together at a laptop ${table}${parentNear}`)
  }
  if (/english|urdu|literature|language|reading|writing/.test(text)) {
    const book = /urdu/.test(text) ? 'an Urdu book' : /english/.test(text) ? 'an English book' : 'a book'
    return scene('reading', `${who} reading ${book} together ${table}${parentNear}`)
  }
  if (input.cluster === 'city-guides') {
    return scene('city', `a ${tutor} tutor and ${student} walking along a calm street in ${city || 'a Pakistani city'}, a recognisable local building in the background`)
  }
  if (input.cluster === 'boards-exams') {
    return scene('exam', `${student} revising at a home desk with notebooks and a desk lamp, a ${tutor} tutor helping`)
  }
  return scene('study', `${who} studying together ${table}${parentNear}`)
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
