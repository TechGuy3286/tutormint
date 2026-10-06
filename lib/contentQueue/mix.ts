// lib/contentQueue/mix.ts
//
// PURE rules that shape the content queue (owner, 6 Oct 2026):
//
//   dedupeTitles()  — never suggest a title that differs from an existing post
//                     or suggestion only by city, grade or subject. The
//                     "skeleton" test is lib/blogApproval titleSkeleton, the same
//                     one the editor's near-duplicate warning uses.
//   balanceMix()    — the queue is ≈40% tutor-career topics; the rest spread
//                     across the other clusters by priority.
//   gscCandidate()  — a Search Console row (query at position 8–20) as a topic:
//                     cluster and audience inferred from the words, the query as
//                     the title, the real figures as evidence (never as notes).
//
// No database, no server-only import — unit-tested in scripts/test-content-mix.ts.

import { titleSkeleton } from '@/lib/blogApproval'
import { slugify } from '@/lib/slugs'
import type { Candidate } from './core'

// ------------------------------------------------------------------ dedupe --

export type ExistingTitle = { title: string; fingerprint?: string | null }

/**
 * Drop any candidate whose title skeleton matches an existing post/suggestion
 * (other than its own row — a candidate refreshing the row it already has is
 * kept), and keep only the first of each skeleton among the candidates
 * themselves (callers pass them highest-priority first).
 */
export function dedupeTitles<T extends { title: string; fingerprint: string }>(
  candidates: T[],
  existing: ExistingTitle[],
  cities: string[],
  subjects: string[],
): T[] {
  const own = new Set(existing.map((e) => e.fingerprint).filter((f): f is string => !!f))
  const existingSkeletons = new Map<string, Set<string>>() // skeleton -> fingerprints that own it
  for (const e of existing) {
    const k = titleSkeleton(e.title, cities, subjects)
    if (!k) continue
    const set = existingSkeletons.get(k) ?? new Set<string>()
    if (e.fingerprint) set.add(e.fingerprint)
    else set.add('')
    existingSkeletons.set(k, set)
  }
  const seen = new Set<string>()
  const out: T[] = []
  for (const c of candidates) {
    const k = titleSkeleton(c.title, cities, subjects)
    if (!k) {
      out.push(c)
      continue
    }
    const owners = existingSkeletons.get(k)
    const ownRow = own.has(c.fingerprint)
    // Blocked when another row (not this candidate's own) already has the shape.
    const blockedByExisting = !!owners && [...owners].some((f) => f !== c.fingerprint)
    if (!ownRow && (blockedByExisting || seen.has(k))) continue
    if (ownRow && seen.has(k)) continue
    seen.add(k)
    out.push(c)
  }
  return out
}

// ----------------------------------------------------------------- balance --

export const CAREER_SHARE = 0.4

/**
 * Keep every tutor-career content candidate and only as many other content
 * candidates (highest priority first) as leaves career at about CAREER_SHARE of
 * the content queue. Recruitment cards pass through untouched — they are not
 * blog topics. With no career candidates nothing is cut.
 */
export function balanceMix<T extends { card: string; cluster: string | null; components: { demand: number; rankProximity: number; seasonality: number; gapAge: number } }>(
  candidates: T[],
  share = CAREER_SHARE,
): T[] {
  const recruitment = candidates.filter((c) => c.card !== 'content')
  const content = candidates.filter((c) => c.card === 'content')
  const career = content.filter((c) => c.cluster === 'tutor-career')
  const others = content.filter((c) => c.cluster !== 'tutor-career')
  if (career.length === 0) return candidates
  // +1e-9: 4 × 0.6 ÷ 0.4 is 5.999… in floating point, and the answer is 6.
  const maxOthers = Math.max(0, Math.floor((career.length * (1 - share)) / share + 1e-9))
  const priority = (c: T) =>
    c.components.demand * c.components.rankProximity * c.components.seasonality * c.components.gapAge
  const keptOthers = [...others].sort((a, b) => priority(b) - priority(a)).slice(0, maxOthers)
  return [...career, ...keptOthers, ...recruitment]
}

// ------------------------------------------------------------ Search Console --

export type GscRow = { query: string; page: string; clicks: number; impressions: number; position: number }

/** Positions 8–20: a page one nudge from page one. */
export const GSC_POSITION_MIN = 8
export const GSC_POSITION_MAX = 20
/** Below this many impressions in 28 days the query is noise. */
export const GSC_IMPRESSIONS_MIN = 3

const CAREER_RE = /\b(tutor(ing)? jobs?|teaching jobs?|teacher jobs?|become a tutor|how to (be|become) a (tutor|teacher)|tutor salary|earn|income|vacanc|teacher required|tutor required|home tutor jobs?|online tutor jobs?)\b/
const EXAM_RE = /\b(exam|exams|board|matric|o level|a level|o-level|a-level|igcse|fsc|intermediate|past papers?|result|results|syllabus|preparation|prep)\b/
const SAFETY_RE = /\b(scam|fake|safe|safety|verify|verified|verification|trust|complaint|fraud)\b/
const COST_RE = /\b(fee|fees|cost|costs|price|prices|rate|rates|charges?|how much|hire|hiring|how to find|find a tutor|home tutor|online tutor|tutor in|tutors in|tuition in|tuitions in)\b/

export function clusterForQuery(query: string, cities: string[] = []): { cluster: string; audience: 'parents' | 'tutors' | 'both' } {
  const q = query.toLowerCase()
  if (CAREER_RE.test(q)) return { cluster: 'tutor-career', audience: 'tutors' }
  if (EXAM_RE.test(q)) return { cluster: 'boards-exams', audience: 'both' }
  if (SAFETY_RE.test(q)) return { cluster: 'safety-trust', audience: 'both' }
  if (COST_RE.test(q)) return { cluster: 'cost-hiring', audience: 'parents' }
  if (cities.some((c) => c && q.includes(c.toLowerCase()))) return { cluster: 'city-guides', audience: 'parents' }
  return { cluster: 'subject-guides', audience: 'parents' }
}

/** The query as a readable title: trimmed, first letter capitalised, a "?" when
 *  it reads as a question. Never templated. */
export function titleFromQuery(query: string): string {
  let t = query.replace(/\s+/g, ' ').trim()
  if (!t) return ''
  t = t[0].toUpperCase() + t.slice(1)
  if (/^(how|what|why|which|when|where|who|is|are|can|do|does|should)\b/i.test(t) && !/[?.!]$/.test(t)) t += '?'
  return t.slice(0, 120)
}

/** A Search Console row as a queue candidate, or null when it is not a page-two
 *  query worth a post. The row's figures go in `evidence` (shown to the manager),
 *  never in `notes` (handed to the model as facts). */
export function gscCandidate(row: GscRow, cities: string[] = []): Candidate | null {
  if (!row.query || row.position < GSC_POSITION_MIN || row.position > GSC_POSITION_MAX) return null
  if (row.impressions < GSC_IMPRESSIONS_MIN) return null
  const title = titleFromQuery(row.query)
  if (!title) return null
  const { cluster, audience } = clusterForQuery(row.query, cities)
  let pagePath = row.page
  try {
    pagePath = new URL(row.page).pathname
  } catch {
    // keep as given
  }
  return {
    fingerprint: `gsc:${slugify(row.query) || 'q'}`,
    card: 'content',
    source: 'gsc',
    title,
    cluster,
    audience,
    language: 'en',
    components: { demand: row.impressions, rankProximity: row.position <= 12 ? 2 : 1.5, seasonality: 1, gapAge: 1 },
    evidence: [
      `${row.impressions} impression${row.impressions === 1 ? '' : 's'}, ${row.clicks} click${row.clicks === 1 ? '' : 's'}, average position ${row.position.toFixed(1)} for “${row.query}” in Google over the last 28 days.`,
      `Google already shows ${pagePath} for it — one nudge from page one.`,
    ],
    evidenceKey: { impressions: row.impressions, position: Math.round(row.position) },
    notes: '',
  }
}

/** Collapse rows by query (GSC returns one row per query × page): keep the best
 *  position's page and sum impressions/clicks. */
export function collapseByQuery(rows: GscRow[]): GscRow[] {
  const by = new Map<string, GscRow>()
  for (const r of rows) {
    const k = r.query.trim().toLowerCase()
    const cur = by.get(k)
    if (!cur) by.set(k, { ...r })
    else {
      by.set(k, {
        query: cur.query,
        page: r.position < cur.position ? r.page : cur.page,
        clicks: cur.clicks + r.clicks,
        impressions: cur.impressions + r.impressions,
        position: Math.min(cur.position, r.position),
      })
    }
  }
  return [...by.values()]
}
