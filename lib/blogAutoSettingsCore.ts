// lib/blogAutoSettingsCore.ts — PURE (owner, 24 Nov 2026 — PR-20 B.3).
//
// The blog editor fills a post's settings by itself from its title (and the
// body when the title is not enough): Topic cluster, Audience, Language, City,
// Subject, the Related landing pages and the cover alt text. It runs when a
// draft is generated or the title changes.
//
// STAFF ALWAYS WIN: every field stays editable, and once staff change a field
// by hand it is "set by hand" (stored on the post, posts.hand_set) and auto-fill
// never overwrites it again. `applyAuto` is that rule.
//
// Related landing pages are ticked only when they TRULY match: the post names a
// city AND a subject and/or a level, and the page is in that city and on that
// subject and level. A Pakistan-wide post (no city) gets none.

import type { PostAudience, PostLanguage } from '@/lib/blog'
import { postTopic, sameLevel, sameSubject, subjectVariants, type PostTopic } from '@/lib/blogRelevanceCore'

export const AUTO_FIELDS = ['cluster', 'audience', 'language', 'city', 'subject', 'related', 'coverAlt'] as const
export type AutoField = (typeof AUTO_FIELDS)[number]

export function isAutoField(s: string): s is AutoField {
  return (AUTO_FIELDS as readonly string[]).includes(s)
}

const norm = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .trim()} `

const has = (text: string, words: string[]) => words.some((w) => text.includes(` ${w} `))

const URDU_SCRIPT = /[؀-ۿ]/g
const ROMAN_URDU = ['kaise', 'kese', 'kya', 'kyun', 'kyon', 'mein', 'aur', 'hai', 'hain', 'ke liye', 'ki', 'ka', 'karein', 'karna', 'bachon', 'bachay', 'apne', 'apna', 'tareeqa', 'behtar', 'liye', 'wala', 'wali']

/** Urdu (Urdu script or Roman Urdu) or English. */
export function inferLanguage(text: string): PostLanguage {
  const letters = (text.match(/\p{L}/gu) ?? []).length
  const urdu = (text.match(URDU_SCRIPT) ?? []).length
  if (letters > 0 && urdu / letters > 0.3) return 'ur'
  const t = norm(text)
  const hits = ROMAN_URDU.filter((w) => t.includes(` ${w} `)).length
  return hits >= 2 ? 'ur' : 'en'
}

const TUTOR_WORDS = ['tutors', 'tutor career', 'become a tutor', 'as a tutor', 'for tutors', 'teaching jobs', 'tuition jobs', 'teacher jobs', 'teaching job', 'earn', 'earning', 'income', 'your cv', 'cv', 'your profile', 'get more students', 'get tuitions', 'find tuitions', 'apply']
const PARENT_WORDS = ['parents', 'parent', 'your child', 'your childs', 'your children', 'kids', 'child', 'son', 'daughter', 'hire a tutor', 'hiring a tutor', 'find a tutor', 'finding a tutor', 'choose a tutor', 'choosing a tutor', 'home tutor for', 'bachon', 'bachay']

/** Who the post is for. A title that speaks to both, or neither, is for everyone. */
export function inferAudience(text: string): PostAudience {
  const t = norm(text)
  // "tutors" alone is about tutors only when the post is not about hiring one.
  const tutor = has(t, TUTOR_WORDS.filter((w) => w !== 'tutors')) || (has(t, ['tutors']) && !has(t, PARENT_WORDS) && /\b(?:for|as|become|tutors can|tutors should)\b/.test(t))
  const parent = has(t, PARENT_WORDS)
  if (tutor && !parent) return 'tutors'
  if (parent && !tutor) return 'parents'
  return 'both'
}

/** The topic cluster, or null when nothing in the text points at one. */
export function inferCluster(text: string, f: { language: PostLanguage; audience: PostAudience; city: string; subject: string }): string | null {
  if (f.language === 'ur') return 'urdu'
  const t = norm(text)
  if (has(t, ['fee', 'fees', 'cost', 'costs', 'price', 'prices', 'rate', 'rates', 'charges', 'how much', 'budget', 'hire', 'hiring', 'salary'])) return 'cost-hiring'
  if (has(t, ['board', 'boards', 'exam', 'exams', 'paper', 'papers', 'past papers', 'result', 'results', 'bise', 'mdcat', 'ecat', 'entry test', 'cambridge', 'caie', 'fbise', 'syllabus', 'date sheet'])) return 'boards-exams'
  if (has(t, ['safe', 'safety', 'trust', 'verify', 'verified', 'verification', 'scam', 'scams', 'fraud', 'red flags', 'warning signs'])) return 'safety-trust'
  if (f.audience === 'tutors' || has(t, ['career', 'become a tutor', 'teaching job', 'teaching jobs', 'tuition jobs', 'earn', 'cv'])) return 'tutor-career'
  if (f.subject) return 'subject-guides'
  if (f.city) return 'city-guides'
  return null
}

/** The longest list name found in the text as whole words (case-insensitive). */
function findName(text: string, names: string[], variants: (n: string) => string[] = (n) => [n]): string {
  const t = norm(text)
  let best = ''
  let bestLen = 0
  for (const n of names) {
    for (const v of variants(n)) {
      const k = norm(v).trim()
      if (k.length < 3) continue
      if (t.includes(` ${k} `) && k.length > bestLen) {
        best = n
        bestLen = k.length
      }
    }
  }
  return best
}

/** A name the body mentions at least twice (the title named none). */
function findInBody(body: string, names: string[], variants: (n: string) => string[] = (n) => [n]): string {
  const t = norm(body)
  let best = ''
  let bestCount = 1
  for (const n of names) {
    let count = 0
    for (const v of variants(n)) {
      const k = norm(v).trim()
      if (k.length < 3) continue
      count += t.split(` ${k} `).length - 1
    }
    if (count > bestCount) {
      best = n
      bestCount = count
    }
  }
  return best
}

export type InferredSettings = {
  cluster: string | null
  audience: PostAudience
  language: PostLanguage
  city: string
  subject: string
}

/**
 * Settings read from the title, and from the body only for what the title does
 * not say (a city or subject the body names at least twice).
 */
export function inferSettings(input: { title: string; body?: string; cities: string[]; subjects: string[] }): InferredSettings {
  const title = input.title ?? ''
  const body = input.body ?? ''
  const both = `${title}\n${body.slice(0, 3000)}`
  const subjVariants = (s: string) => subjectVariants(s)
  const city = findName(title, input.cities) || findInBody(body, input.cities)
  const subject = findName(title, input.subjects, subjVariants) || findInBody(body, input.subjects, subjVariants)
  const language = inferLanguage(title.trim() ? title : both)
  const audience = (() => {
    const a = inferAudience(title)
    return a !== 'both' || !body.trim() ? a : inferAudience(both)
  })()
  const cluster = inferCluster(title, { language, audience, city, subject }) ?? (body.trim() ? inferCluster(both, { language, audience, city, subject }) : null)
  return { cluster, audience, language, city, subject }
}

export type LandingCandidate = { path: string; city?: string | null; level?: string | null; subject?: string | null; count?: number }

/**
 * The landing pages to tick automatically: only those that truly match the
 * post — same city, and the post's subject and level (each one the post
 * names). A post with no city, or with neither a subject nor a level, gets none.
 */
export function autoRelatedPaths(topic: PostTopic, options: LandingCandidate[], limit = 6): string[] {
  if (!topic.city) return []
  const wantSubject = topic.subjects.length > 0
  const wantLevel = topic.groups.length > 0
  if (!wantSubject && !wantLevel) return []
  const cityOf = (c: string | null | undefined) => (c ?? '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9&/]+/g, ' ').replace(/\s+/g, ' ').trim()
  return options
    .filter((o) => cityOf(o.city) === topic.city)
    .filter((o) => (!wantSubject || sameSubject(topic, o.subject)) && (!wantLevel || sameLevel(topic, o.level)))
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((o) => o.path)
}

/** A plain description of the cover for its alt text — never a file name. */
export function autoCoverAlt(p: { title: string; city?: string; subject?: string }): string {
  const title = p.title.replace(/\s+/g, ' ').trim()
  if (!title) return ''
  const what = [p.subject?.trim() ? `${p.subject.trim()} tuition` : '', p.city?.trim() ? `in ${p.city.trim()}` : ''].filter(Boolean).join(' ')
  return `Illustration for the TutorMint article “${title}”${what ? ` about ${what}` : ''}`.slice(0, 300)
}

/** Is this alt text one auto-fill may replace (empty, a file name, or an earlier auto line)? */
export function replaceableAlt(alt: string | null | undefined): boolean {
  const a = (alt ?? '').trim()
  return !a || /\.(?:png|jpe?g|webp|gif|avif)$/i.test(a) || /^(?:IMG|DSC|Screenshot|image)[-_ ]?\d/i.test(a) || a.startsWith('Illustration for the TutorMint article') || a.startsWith('Cover for ')
}

export type AutoValues = {
  cluster: string
  audience: PostAudience
  language: PostLanguage
  city: string
  subject: string
  related: string[]
  coverAlt: string | null
}

/**
 * The new values after auto-fill: every field NOT set by hand takes the
 * inferred value (an empty inference leaves the field as it is); a field set
 * by hand is never touched.
 */
export function applyAuto(
  current: AutoValues,
  handSet: readonly string[],
  input: { title: string; body?: string; cities: string[]; subjects: string[]; landing: LandingCandidate[] },
): AutoValues {
  const hand = new Set(handSet)
  const inf = inferSettings(input)
  const next: AutoValues = { ...current, related: [...current.related] }
  if (!hand.has('language')) next.language = inf.language
  if (!hand.has('audience')) next.audience = inf.audience
  if (!hand.has('city') && inf.city) next.city = inf.city
  if (!hand.has('subject') && inf.subject) next.subject = inf.subject
  if (!hand.has('cluster') && inf.cluster) next.cluster = inf.cluster
  if (!hand.has('related')) next.related = autoRelatedPaths(postTopic({ city: next.city, subject: next.subject, title: input.title }), input.landing)
  if (!hand.has('coverAlt') && replaceableAlt(current.coverAlt)) {
    const alt = autoCoverAlt({ title: input.title, city: next.city, subject: next.subject })
    next.coverAlt = alt || current.coverAlt
  }
  return next
}
