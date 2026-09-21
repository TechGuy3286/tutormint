// lib/landing.ts
//
// The city × subject landing pages (CLAUDE.md 9.1), and the one helper that
// decides whether a subject/city mention anywhere on the site links to a
// landing page or falls back to a browse filter.
//
// THE THRESHOLD IS ONE CONSTANT. A landing page exists only where at least
// THRESHOLD listed tutors (or open tuitions) share a (city, subject); below it
// the route is a 404 and the page is absent from the sitemap. Three is the
// number a thin page needs to not read as empty, and it lives here so the page,
// the sitemap, the admin view and the link helper cannot disagree about it.
//
// EVERYTHING IS DATA. The enumerator is the landing_combinations view
// (migration 48): listed-tutor and open-tuition counts per (city, master_id).
// A subject is a taxonomy_master row, addressed in the URL by a slug derived
// from its level+subject display names; a city is the display string, slugged
// with citySegment().

import { unstable_cache } from 'next/cache'
import { createPublicClient } from '@/lib/supabase/public'
import { fetchTaxonomyTables } from '@/lib/taxonomyBuild'
import { citySegment, cityFromSegment, slugify } from '@/lib/slugs'

export type LandingKind = 'tutors' | 'tuitions'

/** A landing page exists only at or above this many listed tutors / open jobs. */
export const LANDING_THRESHOLD = 3

/** The cache tag every landing-derived cache carries, for on-demand revalidation. */
export const LANDING_TAG = 'landing'

/** A few hours: fresh enough for a directory, cheap enough to serve from cache. */
const LANDING_REVALIDATE = 60 * 60 * 3

export type SubjectMeta = {
  masterId: number
  /** "O Levels Mathematics" — level and subject as the taxonomy names them. */
  name: string
  /** "o-levels-mathematics" — the URL segment. */
  slug: string
  level: string
  subject: string | null
  category: string
}

export type LandingCombo = {
  kind: LandingKind
  city: string
  citySlug: string
  masterId: number
  subjectSlug: string
  subjectName: string
  count: number
}

// --- the subject index: master_id <-> slug, and display names ---------------

/**
 * The landing slug for a taxonomy row. Derived from the display names so the
 * H1 and the URL are the same words, and reversible because the whole index is
 * scanned to resolve a slug back to a master_id.
 */
function subjectSlugFor(level: string, subject: string | null): string {
  return slugify(subject ? `${level} ${subject}` : level)
}

type SubjectIndex = {
  byMaster: Map<number, SubjectMeta>
  bySlug: Map<string, SubjectMeta>
}

const loadSubjectIndex = unstable_cache(
  async (): Promise<{ all: SubjectMeta[]; deduped: SubjectMeta[] }> => {
    const db = createPublicClient()
    // Paginated (fetchTaxonomyTables): taxonomy_master is 4,500+ rows and a bare
    // select is capped at 1000 per PostgREST response, which truncated this
    // master→subject-slug index so a listed row on a higher master id resolved
    // to no landing link.
    const tables = await fetchTaxonomyTables(db)
    const levelName = new Map((tables?.levels ?? []).map((l) => [l.slug, l.name]))
    const subjectName = new Map((tables?.subjects ?? []).map((s) => [s.slug, s.name]))

    // `all` — EVERY master's meta, keyed later by master_id. `deduped` — one
    // master per slug (first wins), for resolving a slug back to a subject.
    //
    // The two must be separate. The old code kept only `deduped` and then looked
    // combos up in it BY MASTER ID — so a live master whose slug had already been
    // claimed by an earlier (legacy) master was absent, and its landing page
    // 404'd even though it had the tutors. Migration 80 kept the pre-2026 masters
    // valid, and they sort first, so every new-taxonomy tutor combo lost its slug
    // to a legacy row and NO tutor landing page resolved at all. A combo is now
    // resolved against its OWN master via `all`, so it always finds its slug.
    const all: SubjectMeta[] = []
    const deduped: SubjectMeta[] = []
    const seen = new Set<string>()
    for (const m of tables?.master ?? []) {
      const level = levelName.get(m.level_slug as string)
      if (!level) continue
      const subject = m.subject_slug ? subjectName.get(m.subject_slug as string) ?? null : null
      const slug = subjectSlugFor(level, subject)
      const meta: SubjectMeta = {
        masterId: m.id as number,
        name: subject ? `${level} ${subject}` : level,
        slug,
        level,
        subject,
        category: (m.level_slug as string) ?? '',
      }
      all.push(meta)
      if (seen.has(slug)) continue
      seen.add(slug)
      deduped.push(meta)
    }
    return { all, deduped }
  },
  ['landing-subject-index-v2'],
  { revalidate: 60 * 60 * 24 },
)

async function subjectIndex(): Promise<SubjectIndex> {
  const { all, deduped } = await loadSubjectIndex()
  const byMaster = new Map<number, SubjectMeta>()
  const bySlug = new Map<string, SubjectMeta>()
  // byMaster covers every master (so a combo is never dropped); bySlug keeps the
  // one-to-one slug → subject map for isSubjectSlug / slug resolution.
  for (const r of all) byMaster.set(r.masterId, r)
  for (const r of deduped) bySlug.set(r.slug, r)
  return { byMaster, bySlug }
}

/**
 * master_id -> subject meta, for callers that hold a taxonomy id and need its
 * display name and slug (the content queue's search-gap signal). Independent of
 * listing counts — a subject with zero listed tutors still resolves here, which
 * is exactly the case a gap signal is about.
 */
export async function subjectMetaByMaster(): Promise<Map<number, SubjectMeta>> {
  return (await subjectIndex()).byMaster
}

/** The URL city segment for a city name, so a signal can build a landing path. */
export { citySegment }

// --- the live combinations --------------------------------------------------

/**
 * Every (kind, city, subject) with its count, from the landing_combinations
 * view. Cached for a few hours and tagged so a listing change can revalidate
 * it on demand. Includes counts BELOW the threshold too — the admin view wants
 * the near-misses, and the page/sitemap filter to >= threshold themselves.
 */
export const liveCombinationsAll = unstable_cache(
  async (): Promise<LandingCombo[]> => {
    const db = createPublicClient()
    const { data } = await db
      .from('landing_combinations')
      .select('kind, city, master_id, n')
    const { byMaster } = await subjectIndex()

    // One page per (kind, city, subject slug). Two masters can share a slug (a
    // legacy and a live row for the same subject name); if both have listings in
    // the same city, keep the busier one so the URL resolves to the fuller page
    // rather than doubling the entry. In practice legacy masters have no live
    // listings, so this only ever fires as a safety net.
    const byKey = new Map<string, LandingCombo>()
    for (const row of data ?? []) {
      const meta = byMaster.get(row.master_id as number)
      if (!meta) continue
      const city = row.city as string
      const combo: LandingCombo = {
        kind: row.kind as LandingKind,
        city,
        citySlug: citySegment(city),
        masterId: row.master_id as number,
        subjectSlug: meta.slug,
        subjectName: meta.name,
        count: row.n as number,
      }
      const key = `${combo.kind}:${combo.citySlug}:${combo.subjectSlug}`
      const existing = byKey.get(key)
      if (!existing || combo.count > existing.count) byKey.set(key, combo)
    }
    return [...byKey.values()]
  },
  ['landing-combinations'],
  { revalidate: LANDING_REVALIDATE, tags: [LANDING_TAG] },
)

/** Only the combinations that clear the threshold — the pages that exist. */
export async function liveLandingPages(): Promise<LandingCombo[]> {
  return (await liveCombinationsAll()).filter((c) => c.count >= LANDING_THRESHOLD)
}

/**
 * Live landing-page paths that match a blog post's city and subject (PR16 §6.4),
 * for the "Browse listings" block. Matches on city name and subject name
 * (case-insensitive), and only returns pages that actually exist (>= threshold),
 * so the block hides itself when nothing matches. Returns tutors first, then
 * tuitions, as site-relative paths ("/tutors/<city>/<subject>").
 */
export async function landingPathsForPost(
  city: string | null | undefined,
  subject: string | null | undefined,
): Promise<string[]> {
  const c = (city ?? '').trim().toLowerCase()
  const s = (subject ?? '').trim().toLowerCase()
  if (!c && !s) return []
  const pages = await liveLandingPages()
  const hits = pages.filter(
    (p) =>
      (!c || p.city.toLowerCase() === c) &&
      (!s || p.subjectName.toLowerCase() === s),
  )
  // Both matched, or nothing (do not widen to city-only or subject-only, which
  // would be a weaker "related").
  const strong = c && s ? hits : []
  const kindOrder = { tutors: 0, tuitions: 1 } as const
  return strong
    .sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind])
    .map((p) => `/${p.kind}/${p.citySlug}/${p.subjectSlug}`)
}

/** Does a landing page exist at this address? */
export async function landingExists(
  kind: LandingKind,
  citySlug: string,
  subjectSlug: string,
): Promise<boolean> {
  const pages = await liveLandingPages()
  return pages.some((p) => p.kind === kind && p.citySlug === citySlug && p.subjectSlug === subjectSlug)
}

/**
 * Resolve a landing URL to its combination, or null when it does not clear the
 * threshold (the page's cue to call notFound()). The city slug is matched
 * against citySegment(city) so it round-trips exactly.
 */
export async function resolveLanding(
  kind: LandingKind,
  citySlug: string,
  subjectSlug: string,
): Promise<LandingCombo | null> {
  const pages = await liveLandingPages()
  return (
    pages.find((p) => p.kind === kind && p.citySlug === citySlug && p.subjectSlug === subjectSlug) ??
    null
  )
}

/** Is this segment a known subject slug at all (live or not)? Used to tell a
 *  tuition landing URL apart from a tuition detail slug on the shared route. */
export async function isSubjectSlug(subjectSlug: string): Promise<boolean> {
  const { bySlug } = await subjectIndex()
  return bySlug.has(subjectSlug)
}

// --- item 4: the one link decision ------------------------------------------

/**
 * The single helper that decides where a subject/city mention points.
 *
 * Landing page if one exists for the combination, the browse filter otherwise
 * — so nothing on the site ever links to a page that is not there. Built once
 * per request (React cache in the callers) by loading the live set; the
 * returned functions are synchronous so a client card can be handed plain
 * hrefs as props.
 */
export type LandingLinker = {
  /** Link for "tutors who teach <subject> in <city>". */
  tutorSubjectHref: (masterId: number, city: string | null) => string
  /** Link for "tuitions wanting <subject> in <city>". */
  tuitionSubjectHref: (masterId: number, city: string | null) => string
}

export async function getLandingLinker(): Promise<LandingLinker> {
  const [pages, { byMaster }] = await Promise.all([liveLandingPages(), subjectIndex()])
  const live = new Set(pages.map((p) => `${p.kind}:${p.citySlug}:${p.subjectSlug}`))

  const href = (kind: LandingKind, masterId: number, city: string | null): string => {
    const meta = byMaster.get(masterId)
    const browse = kind === 'tutors' ? '/browse/tutors' : '/browse/tuitions'
    const fallback = `${browse}?subject=${masterId}${city ? `&city=${encodeURIComponent(city)}` : ''}`
    if (!meta || !city) return fallback
    const citySlug = citySegment(city)
    if (!live.has(`${kind}:${citySlug}:${meta.slug}`)) return fallback
    return `/${kind}/${citySlug}/${meta.slug}`
  }

  return {
    tutorSubjectHref: (m, c) => href('tutors', m, c),
    tuitionSubjectHref: (m, c) => href('tuitions', m, c),
  }
}

// --- the data-built intro (no two pages identical) --------------------------

export type IntroFacts = {
  count: number
  feeMin: number | null
  feeMax: number | null
  modes: string[] // display words already
  areas: string[]
}

/**
 * A sentence, not a stat row, built from real numbers — count, the fee band
 * actually present, the modes offered and the areas represented. Because every
 * one of those varies by combination, no two pages get the same paragraph,
 * which is the whole point of a programmatic landing page.
 */
export function buildIntro(kind: LandingKind, subject: string, city: string, f: IntroFacts): string {
  const rs = (n: number) => `Rs ${n.toLocaleString('en-PK')}`
  const modeClause =
    f.modes.length === 0
      ? ''
      : f.modes.length === 1
        ? ` teaching ${f.modes[0].toLowerCase()}`
        : ` teaching ${f.modes.slice(0, -1).map((m) => m.toLowerCase()).join(', ')} and ${f.modes[f.modes.length - 1].toLowerCase()}`
  const areaClause =
    f.areas.length === 0
      ? ''
      : f.areas.length <= 3
        ? ` across ${listWords(f.areas)}`
        : ` across ${f.areas.slice(0, 3).join(', ')} and other areas`

  if (kind === 'tutors') {
    const fee =
      f.feeMin != null && f.feeMax != null
        ? f.feeMin === f.feeMax
          ? ` Fees are around ${rs(f.feeMin)} a month.`
          : ` Monthly fees run from ${rs(f.feeMin)} to ${rs(f.feeMax)}.`
        : ''
    return (
      `${f.count} verified ${subject} tutor${f.count === 1 ? '' : 's'} in ${city}${modeClause}${areaClause}.` +
      fee +
      ` Every profile is identity-checked, with a video introduction — free to browse, no account needed.`
    )
  }

  const budget =
    f.feeMin != null && f.feeMax != null
      ? f.feeMin === f.feeMax
        ? ` Budgets sit around ${rs(f.feeMin)} a month.`
        : ` Budgets range from ${rs(f.feeMin)} to ${rs(f.feeMax)} a month.`
      : ''
  return (
    `${f.count} open ${subject} tuition${f.count === 1 ? '' : 's'} in ${city}${modeClause}${areaClause}.` +
    budget +
    ` These are live requests from verified parents — apply free once your profile is complete.`
  )
}

function listWords(items: string[]): string {
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

export { cityFromSegment }
