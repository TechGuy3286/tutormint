// lib/searchTermsCore.ts — PURE (owner, 24 Nov 2026 — PR-22 Part D).
//
// Admin → Growth → Search words: the words people typed into Browse tutors /
// Browse tuitions, with counts and the last time, and two actions —
//
//   "Means the same as…"  the word is a Search word for an existing subject,
//                         level, city, area or "online / home" — stored where
//                         the ONE smart search reads it (taxonomy_aliases;
//                         location_area_aliases for an area), so every search
//                         bar uses it at once. Undo takes it back.
//   "Real demand"         a city / subject / level people want that we don't
//                         have. Shown on the Overview to-do as
//                         "Wanted: <term> (N searches)" until it is undone.
//
// And "Suggested pages": a city × subject searched 10+ times in the last 30
// days whose landing page has enough to be indexable (LANDING_THRESHOLD) —
// a suggestion only; staff open it from Landing pages.
//
// PRIVACY: a term is stored only as text and counts per day (search_terms) —
// never with a user, session, IP or device. A term holding a phone number,
// CNIC or email is not stored at all.

import { asciiDigits, hasNumberLeft } from '@/lib/postRedactCore'

export const TERM_MIN = 2
export const TERM_MAX = 80
/** Searches a month that make a city × subject a suggested page. */
export const SUGGEST_MIN_SEARCHES = 10
/** The window of "Wanted" counts and suggested pages (days). */
export const DEMAND_WINDOW_DAYS = 30

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/

/** The words as stored and shown: single-spaced, trimmed, English digits. */
export function cleanTerm(raw: string | null | undefined): string | null {
  const t = asciiDigits(String(raw ?? ''))
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length < TERM_MIN) return null
  // A phone number, CNIC, long digit run or email is never kept.
  if (hasNumberLeft(t) || EMAIL.test(t) || /\d{7,}/.test(t)) return null
  return t.slice(0, TERM_MAX).trim()
}

/** Two spellings that differ only in case, spacing or edge punctuation are one term. */
export function termKey(raw: string | null | undefined): string | null {
  const t = cleanTerm(raw)
  if (!t) return null
  const k = t
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  return k.length >= TERM_MIN ? k.slice(0, TERM_MAX) : null
}

export type TermDayRow = { day: string; surface: 'tutors' | 'tuitions'; term_key: string; term: string; searches: number; zero: number; failed: number; last_at: string }

export type TermRow = {
  key: string
  term: string
  searches: number
  zero: number
  failed: number
  last: string
  surfaces: ('tutors' | 'tuitions')[]
}

/** Days of rows → one row per term (both surfaces together), busiest first. */
export function mergeTerms(rows: readonly TermDayRow[]): TermRow[] {
  const by = new Map<string, TermRow>()
  for (const r of rows) {
    const cur = by.get(r.term_key)
    if (cur) {
      cur.searches += r.searches
      cur.zero += r.zero
      cur.failed += r.failed
      if (r.last_at > cur.last) {
        cur.last = r.last_at
        cur.term = r.term
      }
      if (!cur.surfaces.includes(r.surface)) cur.surfaces.push(r.surface)
    } else by.set(r.term_key, { key: r.term_key, term: r.term, searches: r.searches, zero: r.zero, failed: r.failed, last: r.last_at, surfaces: [r.surface] })
  }
  return [...by.values()].sort((a, b) => b.searches - a.searches || b.last.localeCompare(a.last) || a.key.localeCompare(b.key))
}

export type TermFilter = 'zero' | 'all'
export const isTermFilter = (v: unknown): v is TermFilter => v === 'zero' || v === 'all'

/** Zero results = searched at least once with nothing found; a failed search
 *  (timeout / error) is never a zero result. */
export function filterTerms<T extends TermRow>(rows: readonly T[], filter: TermFilter): T[] {
  return filter === 'zero' ? rows.filter((r) => r.zero > 0) : rows.slice()
}

// ------------------------------------------------------------------ actions ---

export type AliasKind = 'subject' | 'level' | 'city' | 'mode' | 'area'
export type DemandKind = 'city' | 'subject' | 'level'
export const ALIAS_KINDS: AliasKind[] = ['subject', 'level', 'city', 'mode', 'area']
export const DEMAND_KINDS: DemandKind[] = ['city', 'subject', 'level']
export const isAliasKind = (v: unknown): v is AliasKind => typeof v === 'string' && (ALIAS_KINDS as string[]).includes(v)
export const isDemandKind = (v: unknown): v is DemandKind => typeof v === 'string' && (DEMAND_KINDS as string[]).includes(v)

/** The "online / home" targets a word can mean (the job types the smart search reads). */
export const MODE_TARGETS = [
  { slug: 'Online Tutor', name: 'Online' },
  { slug: 'Home Tutor', name: 'Home tutor' },
] as const

export const KIND_LABEL: Record<AliasKind, string> = { subject: 'Subject', level: 'Level', city: 'City', mode: 'Online / home', area: 'Area' }

export type TermAction = {
  id: number
  term_key: string
  term: string
  action: 'alias' | 'demand'
  target_kind: string
  target_slug: string
  target_name: string
  target_city: string | null
  created_at: string
  undone_at: string | null
}

/** The live actions of one term (not undone), newest first. */
export function liveActions(actions: readonly TermAction[], key: string): TermAction[] {
  return actions.filter((a) => a.term_key === key && !a.undone_at).sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/** One "Real demand" row on the Overview to-do. */
export function wantedLine(term: string, searches: number): string {
  return `Wanted: ${term} (${searches} ${searches === 1 ? 'search' : 'searches'})`
}

/** The Search words screen's address for one term. */
export function termHref(key: string): string {
  return `/admin/search-words?term=${encodeURIComponent(key)}`
}

// --------------------------------------------------------- suggested pages ---

export type DemandCount = { city: string; subject: string; searches: number }
export type ComboLike = { kind: 'tutors' | 'tuitions'; city: string; citySlug: string; subjectSlug: string; subjectName: string; subjectOnly?: string | null; count: number; verified?: number }
export type Suggestion = { city: string; subject: string; searches: number; page: ComboLike }

const lc = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

/**
 * City × subject searched SUGGEST_MIN_SEARCHES+ times in the window AND with
 * a landing page that has the minimum content to be indexable (`indexable`,
 * the landing rule) — the fullest such page per city × subject × kind. A
 * suggestion only: nothing is created.
 */
export function suggestPages(demand: readonly DemandCount[], combos: readonly ComboLike[], indexable: (c: ComboLike) => boolean, min = SUGGEST_MIN_SEARCHES): Suggestion[] {
  const sum = new Map<string, DemandCount>()
  for (const d of demand) {
    if (!d.city || !d.subject) continue
    const k = `${lc(d.city)}|${lc(d.subject)}`
    const cur = sum.get(k)
    if (cur) cur.searches += d.searches
    else sum.set(k, { ...d })
  }
  const out: Suggestion[] = []
  for (const d of sum.values()) {
    if (d.searches < min) continue
    const pages = combos.filter((c) => lc(c.city) === lc(d.city) && (lc(c.subjectOnly) === lc(d.subject) || lc(c.subjectName) === lc(d.subject)) && indexable(c))
    for (const kind of ['tutors', 'tuitions'] as const) {
      const best = pages.filter((p) => p.kind === kind).sort((a, b) => b.count - a.count)[0]
      if (best) out.push({ city: d.city, subject: d.subject, searches: d.searches, page: best })
    }
  }
  return out.sort((a, b) => b.searches - a.searches || a.city.localeCompare(b.city))
}

export const pagePath = (c: Pick<ComboLike, 'kind' | 'citySlug' | 'subjectSlug'>) => `/${c.kind}/${c.citySlug}/${c.subjectSlug}`
