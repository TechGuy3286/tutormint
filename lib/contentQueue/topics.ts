// lib/contentQueue/topics.ts
//
// PURE rules that turn raw signals into the "Start from a suggested title"
// queue (owner, 13 Oct 2026). No database, no server-only import — tested in
// scripts/test-content-topics.ts.
//
//   levelGroup()      grades are grouped into the ranges people say: Play Group
//                     to KG, Primary, Middle, Matric, FSc / FA / ICS / I.Com,
//                     O Level, A Level, IGCSE, BS / university. One post per
//                     group + subject + city — never one per grade.
//   subjectTitleName  clean names for titles: no slashes, brackets or codes
//                     ("Mathematics" → "Maths"); a staff "title name" wins.
//   coveredByPost()   a topic an existing post (published, scheduled or draft)
//                     already covers is never suggested.
//   chooseQueue()     the visible queue: real search demand first, tutor career
//                     at most 40%, spread across cities, and one City guides and
//                     one Urdu topic while those clusters have no post.

import { slugify } from '@/lib/slugs'
import type { Candidate } from './core'

// ---------------------------------------------------------------- levels ---

export type LevelGroup = { key: string; label: string }

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * The range a taxonomy level belongs to, with the words a title uses. An
 * unknown level keeps its own name, cleaned of brackets and slashes.
 */
export function levelGroup(level: string | null | undefined, override?: string | null): LevelGroup {
  const o = clean(override ?? '')
  const raw = clean(level ?? '')
  if (o) return { key: slugify(o) || 'level', label: o }
  const l = raw.toLowerCase()
  if (!l) return { key: '', label: '' }
  if (/pre[\s-]*nursery|play\s*group|nursery|\bprep\b|\bkg\b|kindergarten|montessori|pre[\s-]*school/.test(l)) return { key: 'kg', label: 'Play Group and KG' }
  const grade = /\bgrade\s*(\d{1,2})\b/.exec(l)
  if (grade) {
    const n = Number(grade[1])
    if (n <= 5) return { key: 'primary', label: 'Primary' }
    if (n <= 8) return { key: 'middle', label: 'Middle' }
    if (n <= 10) return { key: 'matric', label: 'Matric' }
  }
  if (/\bmatric|\bssc\b/.test(l)) return { key: 'matric', label: 'Matric' }
  if (/^f\.?\s*sc\b|\bfsc\b/.test(l)) return { key: 'fsc', label: 'FSc' }
  if (/^f\.?\s*a\b/.test(l)) return { key: 'fa', label: 'FA' }
  if (/^i\.?\s*c\.?\s*s\b/.test(l)) return { key: 'ics', label: 'ICS' }
  if (/^i\.?\s*com\b/.test(l)) return { key: 'icom', label: 'I.Com' }
  if (/igcse/.test(l)) return { key: 'igcse', label: 'IGCSE' }
  if (/\bo[\s-]*levels?\b/.test(l)) return { key: 'o-level', label: 'O Level' }
  if (/\ba[\s-]*levels?\b/.test(l)) return { key: 'a-level', label: 'A Level' }
  if (/semester|\bbs\b|\badp\b|bachelor|university/.test(l)) return { key: 'bs', label: 'BS' }
  if (/\bms\b|m\.?phil|master/.test(l)) return { key: 'ms', label: 'MS / MPhil' }
  // Anything else: its own name without brackets, slashes or stray codes.
  const label = clean(raw.replace(/\([^)]*\)/g, ' ').split('/')[0].replace(/\s+-\s+.*$/, ''))
  return { key: slugify(label) || 'level', label }
}

// -------------------------------------------------------------- subjects ---

const SHORT: Record<string, string> = {
  mathematics: 'Maths',
  'general mathematics': 'Maths',
  'general science': 'Science',
  'computer science': 'Computer Science',
  'islamiyat / islamic studies': 'Islamiat',
  'islamiat / islamic studies': 'Islamiat',
  islamiyat: 'Islamiat',
  'pakistan studies': 'Pakistan Studies',
}

/** "Mathematics" → "Maths"; "Islamiyat / Islamic Studies" → "Islamiat"; a staff
 *  title name wins over everything. Never a slash, a bracket or a code. */
export function subjectTitleName(subject: string | null | undefined, override?: string | null): string {
  const o = clean(override ?? '')
  if (o) return o
  const raw = clean(subject ?? '')
  if (!raw) return ''
  const known = SHORT[raw.toLowerCase()]
  if (known) return known
  const first = clean(raw.replace(/\([^)]*\)/g, ' ').split('/')[0])
  return SHORT[first.toLowerCase()] ?? first
}

/** "FA Maths", "BS Computer Science", "Play Group and KG English". */
export function topicName(group: LevelGroup, subject: string): string {
  return clean(`${group.label} ${subject}`)
}

/** No raw database label survives into a title. */
export function hasRawLabel(title: string): boolean {
  return /[()\[\]]|\s\/\s|\bpart i\b|semester\s*\d|\b[ivx]+\s*&\s*[ivx]+\b/i.test(title)
}

// ---------------------------------------------------------------- topics ---

export type TopicSignal = {
  level: string
  subject: string
  city: string
  /** Searches on the site (and unmet searches) for it — real demand. */
  searches: number
  /** Listed tutors — a tie-breaker only. */
  tutors: number
  levelTitle?: string | null
  subjectTitle?: string | null
}

export type Topic = {
  key: string
  group: LevelGroup
  subject: string
  city: string
  searches: number
  tutors: number
}

/** Fold per-grade signals into one topic per group + subject + city. */
export function groupTopics(signals: TopicSignal[]): Topic[] {
  const by = new Map<string, Topic>()
  for (const s of signals) {
    const city = clean(s.city)
    const subject = subjectTitleName(s.subject, s.subjectTitle)
    const group = levelGroup(s.level, s.levelTitle)
    if (!city || !subject) continue
    const key = `${group.key}:${slugify(subject)}:${slugify(city)}`
    const cur = by.get(key) ?? { key, group, subject, city, searches: 0, tutors: 0 }
    cur.searches += s.searches
    // The same tutors teach neighbouring grades: the busiest grade stands for the group.
    cur.tutors = Math.max(cur.tutors, s.tutors)
    by.set(key, cur)
  }
  return [...by.values()]
}

const TEMPLATES: { cluster: string; title: (name: string, city: string) => string }[] = [
  { cluster: 'cost-hiring', title: (n, c) => `${n} tutors in ${c}: fees and how to choose` },
  { cluster: 'subject-guides', title: (n, c) => `How to find a good ${n} tutor in ${c}` },
  { cluster: 'cost-hiring', title: (n, c) => `${n} tuition in ${c}: what parents should check first` },
  { cluster: 'subject-guides', title: (n, c) => `Home or online? Choosing a ${n} tutor in ${c}` },
  { cluster: 'cost-hiring', title: (n, c) => `${n} tutors in ${c}: questions to ask before you hire` },
  { cluster: 'subject-guides', title: (n, c) => `A parent's guide to ${n} tuition in ${c}` },
]

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

/** ONE candidate per topic — never "complete guide" AND "fees" for the same
 *  pair. The wording rotates by topic so the queue does not read as one template. */
export function topicCandidate(t: Topic): Candidate {
  const name = topicName(t.group, t.subject)
  const tpl = TEMPLATES[hash(t.key) % TEMPLATES.length]
  const evidence: string[] = []
  if (t.searches > 0) evidence.push(`${t.searches} search${t.searches === 1 ? '' : 'es'} for ${name} in ${t.city} in the last 30 days.`)
  evidence.push(`${t.tutors} listed tutor${t.tutors === 1 ? '' : 's'} match this right now.`)
  return {
    fingerprint: `topic:${t.key}`,
    card: 'content',
    source: t.searches > 0 ? 'search_gap' : 'coverage_gap',
    title: tpl.title(name, t.city),
    cluster: tpl.cluster,
    audience: 'parents',
    language: 'en',
    // Real search demand decides the order; listed tutors only break a tie.
    components: { demand: t.searches > 0 ? 10 + t.searches : 1 + Math.min(t.tutors, 90) / 100, rankProximity: t.tutors >= 3 ? 1.5 : 1, seasonality: 1, gapAge: 1 },
    evidence,
    evidenceKey: { searches: t.searches, tutors: t.tutors, subjectName: name, city: t.city },
    notes: '',
  }
}

// --------------------------------------------------------------- covered ---

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'with', 'by', 'at', 'from', 'your', 'you', 'that', 'this', 'what', 'how', 'why', 'is', 'are', 'be',
  'it', 'its', 'do', 'does', 'should', 'can', 'will', 'before', 'after', 'first', 'actually', 'really', 'good', 'best', 'guide', 'complete',
  // Words every TutorMint title carries — they say nothing about the topic.
  'tutor', 'tutors', 'tutoring', 'tuition', 'tuitions', 'teacher', 'teachers', 'pakistan', 'parent', 'parents', 'tutormint', 'child', 'children',
])

const stem = (w: string) => w.replace(/(ing|ed|es|s|e)$/i, '')

/** The words that say what a title is about. */
export function topicWords(title: string): string[] {
  const out = new Set<string>()
  for (const w of title.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9؀-ۿ]+/)) {
    if (w.length < 3 || STOP.has(w)) continue
    const s = stem(w)
    if (s.length >= 3 && !STOP.has(s)) out.add(s)
  }
  return [...out]
}

/** How alike two titles are: shared topic words over the shorter title's words. */
export function titleOverlap(a: string, b: string): { shared: number; score: number } {
  const A = topicWords(a)
  const B = new Set(topicWords(b))
  if (A.length === 0 || B.size === 0) return { shared: 0, score: 0 }
  const shared = A.filter((w) => B.has(w)).length
  return { shared, score: shared / Math.min(A.length, B.size) }
}

export type ExistingPost = { title: string; status: string; cluster?: string | null; city?: string | null; subject?: string | null }

const low = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * The existing post (published, scheduled or draft — any post that exists) that
 * already covers this candidate, or null. Either the titles say the same thing,
 * or the post is about the same subject group in the same city.
 */
export function coveredByPost(c: { title: string; cluster: string | null; evidenceKey?: Record<string, number | string> }, posts: ExistingPost[]): ExistingPost | null {
  const subject = low(String(c.evidenceKey?.subjectName ?? ''))
  const city = low(String(c.evidenceKey?.city ?? ''))
  for (const p of posts) {
    if (p.status === 'unpublished') continue
    // The same title, whatever its case or punctuation.
    if (plain(c.title) !== '' && plain(c.title) === plain(p.title)) return p
    const o = titleOverlap(c.title, p.title)
    if (o.shared >= 2 && o.score >= 0.6) return p
    if (subject && city) {
      const text = ` ${low(p.title)} `
      const sameCity = low(p.city) === city || text.includes(` ${city}`)
      const subjectWords = topicWords(subject)
      const titleHas = subjectWords.length > 0 && subjectWords.every((w) => topicWords(p.title).includes(w))
      const sameSubject = (low(p.subject) !== '' && titleOverlap(subject, p.subject ?? '').score >= 0.99) || titleHas
      if (sameCity && sameSubject) return p
    }
  }
  return null
}

// ------------------------------------------------------------------- mix ---

export const QUEUE_SIZE = 30
export const CAREER_MAX_SHARE = 0.4

const prio = (c: Candidate) => c.components.demand * c.components.rankProximity * c.components.seasonality * c.components.gapAge
const cityOf = (c: Candidate) => low(String(c.evidenceKey?.city ?? ''))

/**
 * The visible queue, from every eligible candidate:
 *   • tutor career never more than 40% of what is shown;
 *   • one City guides and one Urdu topic while that cluster has no post;
 *   • the parent-side rest by priority (real search demand first), taken a city
 *     at a time so one city cannot fill the queue while others have demand;
 *   • refilled up to `size`.
 */
export function chooseQueue(candidates: Candidate[], opts: { size?: number; emptyClusters?: string[] } = {}): Candidate[] {
  const size = opts.size ?? QUEUE_SIZE
  const content = candidates.filter((c) => c.card === 'content')
  const sorted = [...content].sort((a, b) => prio(b) - prio(a) || a.fingerprint.localeCompare(b.fingerprint))
  const picked: Candidate[] = []
  const has = (c: Candidate) => picked.some((p) => p.fingerprint === c.fingerprint)

  // 1. A cluster with no post at all keeps at least one suggestion.
  for (const cluster of ['city-guides', 'urdu']) {
    if (!(opts.emptyClusters ?? []).includes(cluster)) continue
    const first = sorted.find((c) => c.cluster === cluster)
    if (first) picked.push(first)
  }

  const career = sorted.filter((c) => c.cluster === 'tutor-career')
  const others = sorted.filter((c) => c.cluster !== 'tutor-career' && !has(c))

  // 2. Parent-side topics, a city at a time (topics with no city form one lane).
  const lanes = new Map<string, Candidate[]>()
  for (const c of others) (lanes.get(cityOf(c)) ?? lanes.set(cityOf(c), []).get(cityOf(c))!).push(c)
  const order = [...lanes.entries()].sort((a, b) => prio(b[1][0]) - prio(a[1][0]))
  const spread: Candidate[] = []
  for (let i = 0; spread.length < others.length; i++) {
    let took = false
    for (const [, lane] of order) {
      if (lane[i]) {
        spread.push(lane[i])
        took = true
      }
    }
    if (!took) break
  }

  // 3. Fill: career up to 40% of the final queue, the rest parent-side.
  const careerCap = Math.floor(size * CAREER_MAX_SHARE + 1e-9)
  const otherRoom = size - picked.length
  const takeOthers = spread.slice(0, Math.max(0, otherRoom - Math.min(career.length, careerCap)))
  picked.push(...takeOthers)
  // Career may never exceed 40% of what is actually shown.
  const maxCareer = Math.min(careerCap, Math.floor((picked.length * CAREER_MAX_SHARE) / (1 - CAREER_MAX_SHARE) + 1e-9))
  picked.push(...career.slice(0, Math.max(0, Math.min(maxCareer, size - picked.length))))
  // Room left (few career topics): more parent-side topics.
  for (const c of spread) {
    if (picked.length >= size) break
    if (!has(c)) picked.push(c)
  }
  return picked
}

/** Tutor-career share of a queue, 0–1. */
export function careerShare(queue: { cluster: string | null }[]): number {
  return queue.length === 0 ? 0 : queue.filter((c) => c.cluster === 'tutor-career').length / queue.length
}

// ---------------------------------------------------- city guides and Urdu ---

/** One City guides topic per city with demand. */
export function cityGuideCandidate(city: string, openTuitions: number, listedTutors: number): Candidate {
  return {
    fingerprint: `cityguide:${slugify(city)}`,
    card: 'content',
    source: 'coverage_gap',
    title: `Finding a home tutor in ${city}: areas, fees and what to check`,
    cluster: 'city-guides',
    audience: 'parents',
    language: 'en',
    components: { demand: 5 + Math.min(openTuitions, 400) / 100, rankProximity: 1, seasonality: 1, gapAge: 1 },
    evidence: [`${openTuitions} open tuition${openTuitions === 1 ? '' : 's'} and ${listedTutors} listed tutor${listedTutors === 1 ? '' : 's'} in ${city} right now.`, 'No city guide has been written for it yet.'],
    evidenceKey: { open: openTuitions, tutors: listedTutors, city },
    notes: '',
  }
}

/** Topics for the Urdu cluster. Only the TOPIC is suggested — the post itself
 *  is written in Urdu by staff, so the title here is a plain English working title. */
export const URDU_TOPICS: { slug: string; title: string }[] = [
  { slug: 'find-home-tutor', title: 'Urdu post: how to find a trusted home tutor for your child' },
  { slug: 'become-tutor', title: 'Urdu post: how to start as a home tutor on TutorMint' },
  { slug: 'verified-badge', title: 'Urdu post: what the Verified badge means and how tutors are checked' },
]

export function urduCandidates(): Candidate[] {
  return URDU_TOPICS.map((t) => ({
    fingerprint: `urdu:${t.slug}`,
    card: 'content' as const,
    source: 'coverage_gap' as const,
    title: t.title,
    cluster: 'urdu',
    audience: 'both' as const,
    language: 'ur' as const,
    components: { demand: 4, rankProximity: 1, seasonality: 1, gapAge: 1 },
    evidence: ['Topic only — this post is written in Urdu by staff.'],
    evidenceKey: { topic: t.slug },
    notes: '',
  }))
}
