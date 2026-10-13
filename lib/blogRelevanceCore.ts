// lib/blogRelevanceCore.ts
//
// What is RELATED to a blog post (owner, 13 Oct 2026). One pure rule, used by
// the public post page (the "Browse verified listings" box, "Related reading",
// the tuition cards), the editor's "Related landing pages" checklist, the AI
// writer's link list and the checker — so none of them can call a Grade 7
// English page "related" to a Primary Islamiat post again.
//
// A post's topic is its CITY, its LEVEL GROUP (Primary, Middle, Matric, O Level…
// — lib/contentQueue/topics levelGroup) and its SUBJECT, read from the post's
// own City and Subject fields (the level group falls back to the title). A
// listing carries a taxonomy level and subject; the tiers are:
//
//   with a city      1 subject + level + city   2 subject + city
//                    3 level + city             4 city only
//   without a city   1 subject + level          2 subject        3 level
//
// A listing in a different city is never related to a post that has a city.
// No database, no server-only import — tested in scripts/test-blog-relevance.ts.

import { levelGroup, subjectTitleName } from '@/lib/contentQueue/topics'

const GROUP_KEYS = new Set(['kg', 'primary', 'middle', 'matric', 'fsc', 'fa', 'ics', 'icom', 'igcse', 'o-level', 'a-level', 'bs', 'ms'])

const norm = (s: string | null | undefined) =>
  (s ?? '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9&/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** The level group a piece of free text names ("Primary Islamiat", "Grade 9 &
 *  10 - Science English", "O Level Physics"), or '' when it names none. */
export function groupOfText(text: string | null | undefined): string {
  const t = norm(text)
  if (!t) return ''
  if (/\bprimary\b/.test(t)) return 'primary'
  if (/\bmiddle\b/.test(t)) return 'middle'
  if (/\bmatric/.test(t)) return 'matric'
  if (/\bf sc\b|\bfsc\b/.test(t)) return 'fsc'
  if (/\bi com\b|\bicom\b/.test(t)) return 'icom'
  if (/\bics\b/.test(t)) return 'ics'
  const g = levelGroup(text).key
  return GROUP_KEYS.has(g) ? g : ''
}

// The words of a level, removed from a post's Subject field to leave the subject.
const LEVEL_PHRASES: RegExp[] = [
  /\bgrades?\s*\d{1,2}\s*(?:&|and|to)?\s*\d{1,2}\s*(?:science|arts)(?=\s+\S)/g, // "Grade 9 & 10 - Science English"
  /\bgrades?\s*\d{1,2}(?:\s*(?:&|and|to)?\s*\d{1,2})?\b/g,
  /\bas\s*(?:&|and)\s*a\s*levels?\b/g,
  /\b[oa]\s*levels?\b/g,
  /\bplay\s*group(?:\s*(?:and|to|&)\s*kg)?\b/g,
  /\bpre\s*(?:nursery|school|primary)\b/g,
  /\b(?:primary|middle|matric(?:ulation)?|secondary|intermediate|igcse|nursery|kindergarten|montessori|kg|prep|fsc|f\s*sc|fa|ics|i\s*com|icom|bs|adp|ms|mphil)\b/g,
  /\bpart\s*(?:i{1,2}|1|2)(?:\s*(?:&|and)\s*(?:i{1,2}|1|2))?\b/g,
]

/** The subject a post's Subject field names, without its level words:
 *  "Primary Islamiat" → "islamiat"; "Grade 9 & 10 - Science English" → "english". */
export function subjectOfText(text: string | null | undefined): string {
  let t = norm(text)
  for (const re of LEVEL_PHRASES) t = t.replace(re, ' ')
  return t.replace(/[&/-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Every way a subject may be written: its full name, each part around a slash,
 *  the name without brackets, and the short name titles use ("Maths"). */
export function subjectVariants(subject: string | null | undefined): string[] {
  const raw = (subject ?? '').trim()
  if (!raw) return []
  const out = new Set<string>()
  const add = (s: string) => {
    const n = norm(s).replace(/[&/]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (n) out.add(n)
  }
  add(raw)
  add(raw.replace(/\([^)]*\)/g, ' '))
  for (const part of raw.split('/')) add(part.replace(/\([^)]*\)/g, ' '))
  add(subjectTitleName(raw))
  // Islamiat is spelt two ways in the taxonomy.
  for (const v of [...out]) {
    if (v === 'islamiyat') out.add('islamiat')
    if (v === 'islamiat') out.add('islamiyat')
  }
  return [...out]
}

export type PostTopic = {
  /** Lower-case city, or ''. */
  city: string
  /** Level-group key ("primary", "o-level"…), or ''. */
  group: string
  /** Every way the post's subject may be written, lower-case; empty when none. */
  subjects: string[]
}

export function postTopic(post: { city?: string | null; subject?: string | null; title?: string | null }): PostTopic {
  const rest = subjectOfText(post.subject)
  return {
    city: norm(post.city),
    group: groupOfText(post.subject) || groupOfText(post.title),
    subjects: rest ? subjectVariants(rest) : [],
  }
}

/** A post with no city, level or subject has nothing a listing can match. */
export function topicIsEmpty(t: PostTopic): boolean {
  return !t.city && !t.group && t.subjects.length === 0
}

/** Something a post may be related to: a landing page, a tuition's subject row,
 *  one of a tutor's subjects. `level` and `subject` are the taxonomy names. */
export type Relatable = { city?: string | null; level?: string | null; subject?: string | null }

export function sameSubject(topic: PostTopic, subject: string | null | undefined): boolean {
  if (topic.subjects.length === 0) return false
  const mine = new Set(topic.subjects)
  return subjectVariants(subject).some((v) => mine.has(v))
}

export function sameLevel(topic: PostTopic, level: string | null | undefined): boolean {
  return !!topic.group && groupOfText(level) === topic.group
}

/** 1 (closest) … 4, or 0 when the item is not related to the post at all. */
export function matchTier(topic: PostTopic, item: Relatable): 0 | 1 | 2 | 3 | 4 {
  const subject = sameSubject(topic, item.subject)
  const level = sameLevel(topic, item.level)
  if (topic.city) {
    if (norm(item.city) !== topic.city) return 0
    if (subject && level) return 1
    if (subject) return 2
    if (level) return 3
    return 4
  }
  if (subject && level) return 1
  if (subject) return 2
  if (level) return 3
  return 0
}

export type RankedItem<T> = T & { tier: 1 | 2 | 3 | 4 }

/**
 * The items related to a post, closest first. Empty when nothing is related —
 * the caller hides its box.
 *
 *   closestOnly (the public "Browse verified listings" box): ONLY the closest
 *     tier that has anything — subject + level + city, else subject + city,
 *     else level + city, else the city. A Grade 4 English page is not shown on
 *     an Islamiat post that has Islamiat pages to show.
 *   otherwise (what the writer and the editor may link): tiers 1–3 fill the
 *     list, and city-only pages are used only when nothing closer exists.
 */
export function relevantItems<T extends Relatable & { kind?: string; count?: number; path?: string }>(
  items: T[],
  topic: PostTopic,
  opts: { limit?: number; preferred?: Set<string>; closestOnly?: boolean } = {},
): RankedItem<T>[] {
  const limit = opts.limit ?? 6
  if (topic.city === '' && topic.group === '' && topic.subjects.length === 0) return []
  const tiered = items
    .map((item) => ({ ...item, tier: matchTier(topic, item) }))
    .filter((i): i is RankedItem<T> => i.tier !== 0)
  const pref = (i: T) => (opts.preferred && i.path && opts.preferred.has(i.path) ? 0 : 1)
  const kind = (i: T) => (i.kind === 'tutors' ? 0 : 1)
  const order = (a: RankedItem<T>, b: RankedItem<T>) =>
    a.tier - b.tier || pref(a) - pref(b) || kind(a) - kind(b) || (b.count ?? 0) - (a.count ?? 0) || String(a.path ?? '').localeCompare(String(b.path ?? ''))
  if (tiered.length === 0) return []
  if (opts.closestOnly) {
    const best = Math.min(...tiered.map((i) => i.tier))
    return tiered.filter((i) => i.tier === best).sort(order).slice(0, limit)
  }
  const close = tiered.filter((i) => i.tier <= 3).sort(order)
  if (close.length > 0) return close.slice(0, limit)
  return tiered.sort(order).slice(0, limit)
}

// ------------------------------------------------------------ related posts ---

export type RelatablePost = { id: string; city?: string | null; subject?: string | null; title?: string | null; cluster?: string | null; publishedAt?: string | null }

/**
 * "Related reading": the same subject first, then the same level, then the same
 * city, then the same cluster. A post that shares none of them is never shown.
 */
export function rankRelatedPosts<T extends RelatablePost>(current: RelatablePost, others: T[], limit = 3): T[] {
  const topic = postTopic(current)
  const scored = others
    .filter((p) => p.id !== current.id)
    .map((p) => {
      const t = postTopic(p)
      const subject = topic.subjects.length > 0 && t.subjects.some((s) => topic.subjects.includes(s))
      const level = !!topic.group && t.group === topic.group
      const city = !!topic.city && t.city === topic.city
      const cluster = !!current.cluster && p.cluster === current.cluster
      return { p, score: (subject ? 8 : 0) + (level ? 4 : 0) + (city ? 2 : 0) + (cluster ? 1 : 0) }
    })
    .filter((s) => s.score > 0)
  scored.sort((a, b) => b.score - a.score || String(b.p.publishedAt ?? '').localeCompare(String(a.p.publishedAt ?? '')))
  return scored.slice(0, limit).map((s) => s.p)
}

// ----------------------------------------------------------------- tutors ---

export type TutorForPost = { slug: string; city?: string | null; subjects: { level?: string | null; subject?: string | null }[] }

/**
 * May the writer NAME or link this tutor in the post? Only when the tutor
 * teaches the post's subject at the post's level (and is in the post's city,
 * when the post has one). A post with no subject names no tutor.
 */
export function tutorMatchesPost(topic: PostTopic, tutor: TutorForPost): boolean {
  if (topic.subjects.length === 0) return false
  if (topic.city && norm(tutor.city) !== topic.city) return false
  return tutor.subjects.some((s) => sameSubject(topic, s.subject) && (!topic.group || sameLevel(topic, s.level)))
}

export function matchingTutorSlugs(topic: PostTopic, tutors: TutorForPost[]): string[] {
  return tutors.filter((t) => tutorMatchesPost(topic, t)).map((t) => t.slug)
}
