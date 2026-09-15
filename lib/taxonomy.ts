// lib/taxonomy.ts
//
// Reads the slug-based taxonomy created by supabase/migrations/03_taxonomy.sql:
//
//   taxonomy_categories (slug, name, sort_order)   13 rows   -- "Level 1"
//   taxonomy_levels     (slug, category_slug, ...) 133 rows  -- "Level 2"
//   taxonomy_subjects   (slug, name)               363 rows  -- "Level 3"
//   taxonomy_master     (category_slug, level_slug, subject_slug, leaf_type)
//
// The old tables stored denormalised "Level 1"/"Level 2"/"Level 3" text
// columns. The public API here is unchanged -- every function still takes and
// returns display-name strings -- so callers did not have to change.
//
// The four tables are small (about 1,400 rows total) and are pure reference
// data, so the whole taxonomy is fetched once and cached for the lifetime of
// the page.

import { createClient } from '@/lib/supabase/client'
import { buildTaxonomy, fetchTaxonomyTables, type TaxonomyNode, type TaxonomyRow as Row } from '@/lib/taxonomyBuild'

export type { TaxonomyNode }

let cache: { rows: Row[]; tree: TaxonomyNode } | null = null
let inFlight: Promise<{ rows: Row[]; tree: TaxonomyNode }> | null = null

/**
 * Load the four taxonomy tables (paginated past the PostgREST max-rows cap —
 * taxonomy_master is 4,500+ rows) and resolve master's slugs to display names.
 * The fetch + the pure derivation live in lib/taxonomyBuild.ts so the live test
 * exercises the same code. Cached for the page's lifetime.
 */
async function load(): Promise<{ rows: Row[]; tree: TaxonomyNode }> {
  if (cache) return cache
  if (inFlight) return inFlight

  inFlight = (async () => {
    const tables = await fetchTaxonomyTables(createClient())
    if (!tables) return { rows: [], tree: {} } // do NOT cache a failed fetch
    cache = buildTaxonomy(tables)
    return cache
  })()

  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}

/** category -> level -> subject[] , keyed by display name. */
export async function fetchTaxonomyTree(): Promise<TaxonomyNode> {
  return (await load()).tree
}

/** Top tier: category names ("Level 1"), in the taxonomy's own order. Non-legacy
 *  only, so a category whose grades were all retired (migration 80) drops out. */
export async function fetchLevels(): Promise<string[]> {
  const { rows } = await load()
  return Array.from(new Set(rows.filter((r) => !r.legacy).map((r) => r.category)))
}

/** Second tier: level names ("Level 2") within one category — NON-legacy only,
 *  so a split-away lumped level never appears in a fresh pick (migration 79). */
export async function fetchGradesForLevel(level1: string): Promise<string[]> {
  const { rows } = await load()
  return Array.from(new Set(rows.filter((r) => r.category === level1 && !r.legacy).map((r) => r.level)))
}

/** Third tier: subject names ("Level 3") for one category + level. Non-legacy
 *  only — a fresh pick sees exactly the current dataset's subjects. */
export async function fetchSubjectsForGrade(level1: string, level2: string): Promise<string[]> {
  const { rows } = await load()
  return Array.from(
    new Set(
      rows
        .filter((r) => !r.legacy && r.category === level1 && r.level === level2 && r.subject)
        .map((r) => r.subject as string),
    ),
  ).sort()
}

/** Every subject name in the CURRENT taxonomy (non-legacy). */
export async function fetchAllSubjects(): Promise<string[]> {
  const { rows } = await load()
  return Array.from(new Set(rows.filter((r) => !r.legacy && r.subject).map((r) => r.subject as string))).sort()
}

/** One pickable subject×level combination — a NON-legacy taxonomy_master row with
 *  its display names, for a flat, grouped-by-level picker (PR 3b §2.4). */
export type SubjectMaster = {
  id: number
  category: string
  level: string
  subject: string | null
  isLevelLeaf: boolean
}

/** Every pickable (non-legacy) subject×level combination, for the settings
 *  subject picker: flat, so it can group by level and order by demand without a
 *  level-first cascade gate. */
export async function fetchNonLegacyMasters(): Promise<SubjectMaster[]> {
  const { rows } = await load()
  return rows
    .filter((r) => !r.legacy)
    .map((r) => ({ id: r.id, category: r.category, level: r.level, subject: r.subject, isLevelLeaf: r.isLevelLeaf }))
}

/** id -> display label for a set of master ids (legacy included, so a retired
 *  saved subject still labels), keyed by id so a selected-chip row can name any
 *  saved subject. */
export async function labelsByMasterId(ids: number[]): Promise<Map<number, string>> {
  const { rows } = await load()
  const set = new Set(ids)
  const out = new Map<number, string>()
  for (const r of rows) {
    if (set.has(r.id)) out.set(r.id, r.subject ? `${r.level} — ${r.subject}` : r.level)
  }
  return out
}

/**
 * Resolve display-name selections to taxonomy_master ids -- the only thing
 * tutor_subjects / job_subjects store.
 *
 * For a level-leaf (Test Preparations, Sports & Games, Holy Quran) pass
 * subjects: [] and the level's own master row is returned.
 */
export async function resolveMasterIds(
  category: string,
  levels: string | string[],
  subjects: string[],
): Promise<number[]> {
  const { rows } = await load()
  // Level is a MULTI-select now (migration 79). Accept one level or an array,
  // and resolve subjects × EVERY selected level: a job spanning Grade 1–3 in
  // Physics resolves to the Grade 1/2/3 Physics master ids, so master_id
  // intersection alone realises level containment.
  const levelList = Array.isArray(levels) ? levels : levels ? [levels] : []
  const ids: number[] = []
  for (const level of levelList) {
    // Non-legacy only: a fresh pick resolves to CURRENT master ids. Were legacy
    // rows included, a live grade name that a retired grade also carries (old
    // "Grade 1") would drag its retired master ids into every new post.
    const inLevel = rows.filter((r) => !r.legacy && r.category === category && r.level === level)
    if (subjects.length === 0) {
      const leaf = inLevel.find((r) => r.isLevelLeaf)
      if (leaf) ids.push(leaf.id)
    } else {
      for (const r of inLevel) if (r.subject && subjects.includes(r.subject)) ids.push(r.id)
    }
  }
  return Array.from(new Set(ids))
}

/** True when this level is selectable on its own, with no subject beneath it.
 *  Non-legacy only. The current dataset (migration 80) has NO level-leaves — Test
 *  Preparations, Sports & Games and Holy Quran are now one grade with many
 *  subjects — so this is false for every live pick; it stays for the retired
 *  leaves, which are never offered. */
export async function isLevelLeaf(category: string, level: string): Promise<boolean> {
  const { rows } = await load()
  return rows.some((r) => !r.legacy && r.category === category && r.level === level && r.isLevelLeaf)
}

/** Display labels for a set of master ids, for showing what is already saved.
 *  Reads ALL rows by id (legacy included), so a job/tutor on the retired
 *  taxonomy still renders its saved subjects until it is re-picked. */
export async function labelsForMasterIds(ids: number[]): Promise<string[]> {
  const { rows } = await load()
  const set = new Set(ids)
  return rows.filter((r) => set.has(r.id)).map((r) => (r.subject ? `${r.level} — ${r.subject}` : r.level))
}

/**
 * The reverse of resolveMasterIds: turn stored taxonomy_master ids back into
 * the cascade selection that produced them.
 *
 * The job edit form needs this. Without it the subject step opened empty on
 * every edit, so a parent changing only the budget had to re-pick their
 * subjects from scratch -- and if they did not notice, the form submitted
 * whatever was on screen.
 *
 * A job's subjects all come from one pass through the cascade, so they share a
 * category; the first row decides it. Level is multi-select, so this returns
 * EVERY distinct level across the ids (a job on Grade 1–3 comes back with all
 * three checked) and the union of their subjects.
 *
 * NON-LEGACY only (migration 80): a row on the retired taxonomy comes back EMPTY,
 * so the edit form's taxonomy step opens clean rather than pre-filled with a
 * retired category/grade that no longer exists in the pickers. The card still
 * renders its saved labels (labelsForMasterIds, by id) and still matches; the
 * person re-picks from the current dataset on their next edit.
 */
export async function selectionForMasterIds(
  ids: number[],
): Promise<{ category: string; levels: string[]; subjects: string[]; isLevelLeaf: boolean }> {
  const empty = { category: '', levels: [] as string[], subjects: [] as string[], isLevelLeaf: false }
  if (ids.length === 0) return empty

  const { rows } = await load()
  const set = new Set(ids)
  const mine = rows.filter((r) => set.has(r.id) && !r.legacy)
  if (mine.length === 0) return empty

  const category = mine[0].category
  const inCat = mine.filter((r) => r.category === category)

  return {
    category,
    levels: Array.from(new Set(inCat.map((r) => r.level))),
    subjects: Array.from(new Set(inCat.map((r) => r.subject).filter(Boolean))) as string[],
    isLevelLeaf: inCat.some((r) => r.isLevelLeaf),
  }
}
