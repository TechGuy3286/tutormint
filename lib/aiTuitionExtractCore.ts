// lib/aiTuitionExtractCore.ts — PURE (owner, 23 Nov 2026 — PR-18 Part A.1).
//
// "Paste a post" on staff Post a tuition: a raw Facebook / WhatsApp tuition
// post (English, Roman Urdu or Urdu) → the fields of the existing form. The AI
// only READS the post (with every number already replaced — lib/postRedactCore)
// and answers in JSON; this file maps that answer onto OUR lists only: the Job
// Type titles (job_titles), the curated cities (location_cities), and the
// taxonomy (category → grade → subject). Anything that does not map, or that
// the AI said it was unsure of, is returned in `uncertain`, and the form
// highlights it for staff to check. Nothing is ever posted from here: staff
// review the form and press Post themselves.
//
// The title follows our format "Post type | Class | School name | City" (the
// area stands in for the school when there is none — item 17).

import type { DaySlot, DayKey, SlotKey } from '@/lib/timeSlots'
import { collapseLevels } from '@/lib/levelDisplay'
import { hasNumberLeft, redactForAi } from '@/lib/postRedactCore'

export type TaxonomyTree = Record<string, Record<string, string[]>>

export type AiLists = { jobTitles: string[]; cities: string[]; tree: TaxonomyTree }

/** What the model is asked to return (every field may be null / empty). */
export type AiAnswer = {
  jobType?: string | null
  mode?: 'home' | 'online' | null
  city?: string | null
  area?: string | null
  category?: string | null
  levels?: string[] | null
  subjectsByLevel?: Record<string, string[]> | null
  gender?: 'male' | 'female' | null
  days?: string[] | null
  times?: string[] | null
  feeMin?: number | null
  feeMax?: number | null
  school?: string | null
  description?: string | null
  unsure?: string[] | null
}

/** The form keys that can be highlighted. */
export const FILL_KEYS = ['teachingMode', 'city', 'area', 'levels', 'subjects', 'genderPreference', 'schedule', 'budget', 'school', 'title', 'contactPhone'] as const
export type FillKey = (typeof FILL_KEYS)[number]

export type AiFill = {
  teachingMode: string
  city: string
  area: string
  category: string
  levels: string[]
  gradeSubjects: Record<string, string[]>
  subjects: string[]
  genderPreference: '' | 'male' | 'female'
  scheduleSlots: DaySlot[]
  budgetMin: string
  budgetMax: string
  feeExact: boolean
  school: string
  title: string
  description: string
  uncertain: FillKey[]
}

export const AI_UNAVAILABLE = 'The AI could not read this post just now. Fill the form by hand — it works as usual.'
export const AI_CAP_REACHED = "You have used today's AI fills. Fill the form by hand — it works as usual."
export const AI_DAILY_CAP = 200
/** Plain messages for the two failures staff can do something about (PR-21). */
export const AI_BUSY = 'The AI is busy — please try again in a minute.'
export const AI_TOO_SLOW = 'Took too long — please try again.'

export type AiFailureKind = 'busy' | 'timeout' | 'other'

/** What a failed AI call means for staff: busy (rate limit / overload / server
 *  error at Anthropic), too slow (our time limit), or anything else. */
export function aiFailureKind(reason: string): AiFailureKind {
  if (/timed out|abort/i.test(reason)) return 'timeout'
  if (/anthropic (?:408|409|429|500|502|503|504|529)\b|overloaded|rate[\s_-]?limit/i.test(reason)) return 'busy'
  return 'other'
}

export function aiFailureMessage(kind: AiFailureKind): string {
  return kind === 'busy' ? AI_BUSY : kind === 'timeout' ? AI_TOO_SLOW : AI_UNAVAILABLE
}

/** A technical failure reason fit for the audit log and the function log: one
 *  line, at most 160 characters, with any number or email taken out — it never
 *  carries post or image content (only HTTP statuses and error names). */
export function safeReason(reason: string): string {
  return redactForAi(String(reason ?? '').replace(/\s+/g, ' ')).text.slice(0, 160)
}

const norm = (s: string | null | undefined) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .trim()

/** Common short forms in tuition posts → the taxonomy's own words. */
const SUBJECT_ALIASES: Record<string, string> = {
  maths: 'mathematics',
  math: 'mathematics',
  eng: 'english',
  bio: 'biology',
  chem: 'chemistry',
  phy: 'physics',
  physic: 'physics',
  comp: 'computer science',
  computer: 'computer science',
  cs: 'computer science',
  isl: 'islamiat',
  islamiyat: 'islamiat',
  'pak studies': 'pakistan studies',
  'pak st': 'pakistan studies',
  'pak study': 'pakistan studies',
  sst: 'social studies',
  'all subjects': '*',
}

function pick(list: string[], raw: string | null | undefined): string | null {
  const n = norm(raw)
  if (!n) return null
  const exact = list.find((x) => norm(x) === n)
  if (exact) return exact
  const starts = list.filter((x) => norm(x).startsWith(n) || n.startsWith(norm(x)))
  return starts.length === 1 ? starts[0] : null
}

function pickSubject(list: string[], raw: string): string[] | null {
  const n = norm(raw)
  const alias = SUBJECT_ALIASES[n]
  if (alias === '*') return list.slice()
  const want = alias ?? n
  const hit = pick(list, want)
  return hit ? [hit] : null
}

const DAY_WORDS: Record<string, DayKey> = {
  mon: 'mon', monday: 'mon', peer: 'mon',
  tue: 'tue', tuesday: 'tue', mangal: 'tue',
  wed: 'wed', wednesday: 'wed', budh: 'wed',
  thu: 'thu', thursday: 'thu', jumerat: 'thu',
  fri: 'fri', friday: 'fri', juma: 'fri',
  sat: 'sat', saturday: 'sat', hafta: 'sat',
  sun: 'sun', sunday: 'sun', itwar: 'sun',
}
const WEEKDAYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri']
const ALL_DAYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

function daysOf(raw: string[] | null | undefined): DayKey[] {
  const out = new Set<DayKey>()
  for (const d of raw ?? []) {
    const n = norm(d)
    if (n === 'weekdays' || n === 'mon fri' || n === 'monday to friday') WEEKDAYS.forEach((x) => out.add(x))
    else if (n === 'weekends' || n === 'weekend') ['sat', 'sun'].forEach((x) => out.add(x as DayKey))
    else if (n === 'daily' || n === 'all days' || n === 'everyday') ALL_DAYS.forEach((x) => out.add(x))
    else if (DAY_WORDS[n]) out.add(DAY_WORDS[n])
    else if (DAY_WORDS[n.slice(0, 3)]) out.add(DAY_WORDS[n.slice(0, 3)])
  }
  return ALL_DAYS.filter((d) => out.has(d))
}

function slotsOf(raw: string[] | null | undefined): SlotKey[] {
  const out = new Set<SlotKey>()
  for (const t of raw ?? []) {
    const n = norm(t)
    if (n.startsWith('morn')) out.add('morning')
    else if (n.startsWith('after') || n === 'noon') out.add('afternoon')
    else if (n.startsWith('even') || n.startsWith('night')) out.add('evening')
  }
  return (['morning', 'afternoon', 'evening'] as SlotKey[]).filter((s) => out.has(s))
}

/** "Post type | Class | School name | City" — empty parts left out. */
export function formatTitle(p: { jobType: string; levels: string[]; school: string; area: string; city: string }): string {
  const cls = collapseLevels(p.levels)
  return [p.jobType, cls, p.school.trim() || p.area.trim(), p.city].map((x) => (x ?? '').trim()).filter(Boolean).join(' | ')
}

const UNSURE_MAP: Record<string, FillKey> = {
  jobtype: 'teachingMode', job_type: 'teachingMode', mode: 'teachingMode',
  city: 'city', area: 'area',
  category: 'levels', levels: 'levels', grade: 'levels', grades: 'levels', class: 'levels',
  subjects: 'subjects', subjectsbylevel: 'subjects',
  gender: 'genderPreference',
  days: 'schedule', times: 'schedule', schedule: 'schedule', timing: 'schedule',
  fee: 'budget', feemin: 'budget', feemax: 'budget', budget: 'budget',
  school: 'school', title: 'title',
}

/** Map the model's answer onto the form, against our lists only. */
export function mapAiAnswer(ai: AiAnswer, lists: AiLists): AiFill {
  const uncertain = new Set<FillKey>()
  for (const u of ai.unsure ?? []) {
    const k = UNSURE_MAP[String(u).toLowerCase().replace(/[^a-z_]/g, '')]
    if (k) uncertain.add(k)
  }

  // Job Type: one of the titles; else home / online picks the title that says so.
  let teachingMode = pick(lists.jobTitles, ai.jobType) ?? ''
  if (!teachingMode && ai.mode) {
    const want = ai.mode === 'online' ? 'online' : 'home'
    teachingMode = lists.jobTitles.find((t) => norm(t).includes(want)) ?? ''
  }
  if (!teachingMode) uncertain.add('teachingMode')

  const city = pick(lists.cities, ai.city) ?? ''
  if (!city) uncertain.add('city')
  const area = String(ai.area ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!area) uncertain.add('area')

  // Category → grades → subjects. A grade named without its category finds it.
  let category = pick(Object.keys(lists.tree), ai.category) ?? ''
  const rawLevels = (ai.levels ?? []).map(String).filter(Boolean)
  if (!category && rawLevels.length > 0) {
    category = Object.keys(lists.tree).find((c) => rawLevels.some((l) => pick(Object.keys(lists.tree[c] ?? {}), l))) ?? ''
  }
  const levelNames = category ? Object.keys(lists.tree[category] ?? {}) : []
  const levels: string[] = []
  for (const l of rawLevels) {
    const hit = pick(levelNames, l)
    if (hit && !levels.includes(hit)) levels.push(hit)
    else if (!hit) uncertain.add('levels')
  }
  if (!category || levels.length === 0) uncertain.add('levels')

  const gradeSubjects: Record<string, string[]> = {}
  const byLevel = ai.subjectsByLevel ?? {}
  const allNamed = Object.values(byLevel).flat().map(String)
  for (const g of levels) {
    const offered = lists.tree[category]?.[g] ?? []
    if (offered.length === 0) continue // a leaf level (Holy Quran, Test Prep…) has no subject list
    const key = Object.keys(byLevel).find((k) => pick([g], k)) ?? null
    const named = key ? (byLevel[key] ?? []).map(String) : allNamed
    const got: string[] = []
    for (const s of named) {
      const hit = pickSubject(offered, s)
      if (!hit) {
        uncertain.add('subjects')
        continue
      }
      for (const h of hit) if (!got.includes(h)) got.push(h)
    }
    if (got.length === 0) uncertain.add('subjects')
    gradeSubjects[g] = got
  }
  const subjects = [...new Set(Object.values(gradeSubjects).flat())]

  const genderPreference = ai.gender === 'male' || ai.gender === 'female' ? ai.gender : ''

  const days = daysOf(ai.days)
  const times = slotsOf(ai.times)
  const scheduleSlots: DaySlot[] = []
  if (days.length > 0 && times.length > 0) for (const d of days) for (const s of times) scheduleSlots.push({ day: d, slot: s })
  if ((ai.days ?? []).length > 0 !== days.length > 0 || (ai.times ?? []).length > 0 !== times.length > 0) uncertain.add('schedule')

  const whole = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 10_000_000 ? String(Math.round(n)) : '')
  let budgetMin = whole(ai.feeMin)
  let budgetMax = whole(ai.feeMax)
  if (budgetMin && !budgetMax) budgetMax = budgetMin
  if (budgetMax && !budgetMin) budgetMin = budgetMax
  if (budgetMin && budgetMax && Number(budgetMin) > Number(budgetMax)) [budgetMin, budgetMax] = [budgetMax, budgetMin]
  const feeExact = !!budgetMin && budgetMin === budgetMax
  if (!budgetMin) uncertain.add('budget')

  const school = String(ai.school ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const title = formatTitle({ jobType: teachingMode, levels, school, area, city })
  if (uncertain.has('teachingMode') || uncertain.has('levels') || uncertain.has('city')) uncertain.add('title')
  const description = String(ai.description ?? '').trim().slice(0, 2000)

  return {
    teachingMode,
    city,
    area,
    category,
    levels,
    gradeSubjects,
    subjects,
    genderPreference,
    scheduleSlots,
    budgetMin,
    budgetMax,
    feeExact,
    school,
    title,
    description,
    uncertain: FILL_KEYS.filter((k) => uncertain.has(k)),
  }
}

/** Pull the JSON object out of the model's reply (it may wrap it in a fence). */
export function parseAiJson(text: string): AiAnswer | null {
  const t = String(text ?? '')
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const v = JSON.parse(t.slice(start, end + 1)) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as AiAnswer) : null
  } catch {
    return null
  }
}

export const EXTRACT_SYSTEM = [
  'You read tuition adverts from Pakistan (English, Roman Urdu or Urdu) and fill a form.',
  'Answer with ONE JSON object only, no prose. Use only the option names given; if nothing fits, use null.',
  'Phone numbers have been removed and replaced with [PHONE_n]; never guess or write a number other than the fee.',
  'Keys: jobType (one of JOB TYPES), mode ("home"|"online"|null), city (one of CITIES), area (the neighbourhood as written, English letters),',
  'category (one of the CATEGORY names), levels (grade names under that category), subjectsByLevel (object: grade name → subject names),',
  'gender (preferred TUTOR gender: "male"|"female"|null), days (e.g. ["mon","tue"] or ["weekdays"]), times (["morning"|"afternoon"|"evening"]),',
  'feeMin, feeMax (monthly fee in rupees as numbers, or null), school (school or academy name, or null),',
  'description (2–4 plain English sentences for tutors: who needs what, where, when; no phone numbers, no names of the parent),',
  'unsure (array of the keys above you are not sure about).',
].join(' ')

/** The user message: our lists, then the redacted post. */
export function extractPrompt(redactedPost: string, lists: AiLists): string {
  const cats = Object.keys(lists.tree)
    .map((c) => `${c}: ${Object.keys(lists.tree[c] ?? {}).join(', ')}`)
    .join('\n')
  const subjects = [...new Set(Object.values(lists.tree).flatMap((l) => Object.values(l).flat()))].sort().join(', ')
  return [
    `JOB TYPES: ${lists.jobTitles.join(', ')}`,
    `CITIES: ${lists.cities.join(', ')}`,
    `CATEGORY: grades\n${cats}`,
    `SUBJECTS: ${subjects}`,
    '',
    'POST:',
    redactedPost.slice(0, 6000),
  ].join('\n')
}

// ------------------------------------------------------------ the pipeline ---

export type Completer = (a: { system: string; prompt: string; maxTokens?: number; timeoutMs?: number; effort?: 'low' | 'medium' | 'high' }) => Promise<{ ok: true; text: string } | { ok: false; reason: string }>

export type ExtractResult = { ok: true; fill: AiFill } | { ok: false; status: number; error: string; reason?: string }

/**
 * Post → form. The post is redacted AGAIN here (whatever the browser sent),
 * and the AI is never called while anything number-shaped is left. The AI
 * call is passed in (lib/aiTuitionExtract gives the real one; tests a mock).
 */
export async function runExtraction(post: string, lists: AiLists, completer: Completer): Promise<ExtractResult> {
  const red = redactForAi(post)
  if (hasNumberLeft(red.text)) return { ok: false, status: 400, error: 'Remove the phone numbers from the post and try again.', reason: 'number_left' }
  if (lists.jobTitles.length === 0 || Object.keys(lists.tree).length === 0) return { ok: false, status: 503, error: AI_UNAVAILABLE, reason: 'lists_empty' }
  const res = await completer({ system: EXTRACT_SYSTEM, prompt: extractPrompt(red.text, lists), maxTokens: 1200, timeoutMs: 30_000, effort: 'low' })
  if (!res.ok) {
    const kind = aiFailureKind(res.reason)
    return { ok: false, status: kind === 'timeout' ? 504 : 503, error: aiFailureMessage(kind), reason: `ai_${kind}: ${safeReason(res.reason)}` }
  }
  const ai = parseAiJson(res.text)
  if (!ai) return { ok: false, status: 503, error: AI_UNAVAILABLE, reason: 'ai_unreadable_answer' }
  return { ok: true, fill: mapAiAnswer(ai, lists) }
}
