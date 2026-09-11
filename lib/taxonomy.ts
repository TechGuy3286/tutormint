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

export type TaxonomyNode = Record<string, Record<string, string[]>>

type Row = {
  id: number
  category: string
  level: string
  subject: string | null
  isLevelLeaf: boolean
  /** A lumped level split in migration 79 — valid on existing rows, hidden from
   *  the pickers unless it is the pre-selected level of a job/profile being edited. */
  legacy: boolean
}

let cache: { rows: Row[]; tree: TaxonomyNode } | null = null
let inFlight: Promise<{ rows: Row[]; tree: TaxonomyNode }> | null = null

/**
 * Load the four taxonomy tables and resolve master's slugs to display names.
 * Joined client-side rather than through PostgREST embedding: the tables are
 * tiny, and this avoids depending on embed alias naming.
 */
async function load(): Promise<{ rows: Row[]; tree: TaxonomyNode }> {
  if (cache) return cache
  if (inFlight) return inFlight

  inFlight = (async () => {
    const supabase = createClient()

    const [categories, levels, subjects, master] = await Promise.all([
      supabase.from('taxonomy_categories').select('slug, name, sort_order'),
      supabase.from('taxonomy_levels').select('slug, category_slug, name, sort_order, legacy'),
      supabase.from('taxonomy_subjects').select('slug, name'),
      supabase.from('taxonomy_master').select('id, category_slug, level_slug, subject_slug, leaf_type'),
    ])

    const failed = [categories, levels, subjects, master].find((r) => r.error)
    if (failed?.error) {
      console.error('Error fetching taxonomy:', failed.error)
      return { rows: [], tree: {} }
    }

    const categoryName = new Map<string, string>()
    const categoryOrder = new Map<string, number>()
    for (const c of categories.data ?? []) {
      categoryName.set(c.slug, c.name)
      categoryOrder.set(c.slug, c.sort_order ?? 0)
    }

    const levelName = new Map<string, string>()
    const levelOrder = new Map<string, number>()
    const levelLegacy = new Map<string, boolean>()
    for (const l of levels.data ?? []) {
      levelName.set(l.slug, l.name)
      levelOrder.set(l.slug, l.sort_order ?? 0)
      levelLegacy.set(l.slug, !!l.legacy)
    }

    const subjectName = new Map<string, string>()
    for (const s of subjects.data ?? []) subjectName.set(s.slug, s.name)

    // Keep master in the taxonomy's own sort order, not alphabetical, so the
    // dropdowns read Pre-Primary -> Primary -> Middle -> ... as authored.
    const ordered = [...(master.data ?? [])].sort((a, b) => {
      const c = (categoryOrder.get(a.category_slug) ?? 0) - (categoryOrder.get(b.category_slug) ?? 0)
      if (c !== 0) return c
      return (levelOrder.get(a.level_slug) ?? 0) - (levelOrder.get(b.level_slug) ?? 0)
    })

    const rows: Row[] = []
    for (const m of ordered) {
      const category = categoryName.get(m.category_slug)
      const level = levelName.get(m.level_slug)
      if (!category || !level) continue
      // subject_slug is null for the 120 level-only rows in the seed.
      rows.push({
        id: m.id,
        category,
        level,
        subject: m.subject_slug ? subjectName.get(m.subject_slug) ?? null : null,
        // Level-leaf: the level itself is the selectable item (Test
        // Preparations, Sports & Games, Holy Quran). leaf_type is reliable
        // since 12_taxonomy_leaf_type.sql; subject_slug IS NULL is equivalent.
        isLevelLeaf: m.leaf_type === 'level' || m.subject_slug === null,
        legacy: levelLegacy.get(m.level_slug) ?? false,
      })
    }

    const tree: TaxonomyNode = {}
    for (const r of rows) {
      if (!tree[r.category]) tree[r.category] = {}
      if (!tree[r.category][r.level]) tree[r.category][r.level] = []
      if (r.subject && !tree[r.category][r.level].includes(r.subject)) {
        tree[r.category][r.level].push(r.subject)
      }
    }

    cache = { rows, tree }
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

/** Top tier: category names ("Level 1"), in the taxonomy's own order. */
export async function fetchLevels(): Promise<string[]> {
  const { rows } = await load()
  return Array.from(new Set(rows.map((r) => r.category)))
}

/** Second tier: level names ("Level 2") within one category — NON-legacy only,
 *  so a split-away lumped level never appears in a fresh pick (migration 79). */
export async function fetchGradesForLevel(level1: string): Promise<string[]> {
  const { rows } = await load()
  return Array.from(new Set(rows.filter((r) => r.category === level1 && !r.legacy).map((r) => r.level)))
}

/** The set of legacy level NAMES (migration 79). The multi-select grade picker
 *  hides these except when one is the pre-selected level of a row being edited. */
export async function fetchLegacyLevelNames(): Promise<Set<string>> {
  const { rows } = await load()
  return new Set(rows.filter((r) => r.legacy).map((r) => r.level))
}

/** Third tier: subject names ("Level 3") for one category + level. */
export async function fetchSubjectsForGrade(level1: string, level2: string): Promise<string[]> {
  const { rows } = await load()
  return Array.from(
    new Set(
      rows
        .filter((r) => r.category === level1 && r.level === level2 && r.subject)
        .map((r) => r.subject as string),
    ),
  ).sort()
}

/** Every subject name in the taxonomy. */
export async function fetchAllSubjects(): Promise<string[]> {
  const { rows } = await load()
  return Array.from(new Set(rows.filter((r) => r.subject).map((r) => r.subject as string))).sort()
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
    const inLevel = rows.filter((r) => r.category === category && r.level === level)
    if (subjects.length === 0) {
      const leaf = inLevel.find((r) => r.isLevelLeaf)
      if (leaf) ids.push(leaf.id)
    } else {
      for (const r of inLevel) if (r.subject && subjects.includes(r.subject)) ids.push(r.id)
    }
  }
  return Array.from(new Set(ids))
}

/** True when this level is selectable on its own, with no subject beneath it. */
export async function isLevelLeaf(category: string, level: string): Promise<boolean> {
  const { rows } = await load()
  return rows.some((r) => r.category === category && r.level === level && r.isLevelLeaf)
}

/** Display labels for a set of master ids, for showing what is already saved. */
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
 * category; the first row decides it. Level is multi-select now (migration 79),
 * so this returns EVERY distinct level across the ids (a job on Grade 1–3 comes
 * back with all three checked) and the union of their subjects. An existing row
 * on a lumped/legacy level comes back with that legacy level, which the picker
 * shows as a checked, re-pickable option.
 */
export async function selectionForMasterIds(
  ids: number[],
): Promise<{ category: string; levels: string[]; subjects: string[]; isLevelLeaf: boolean }> {
  const empty = { category: '', levels: [] as string[], subjects: [] as string[], isLevelLeaf: false }
  if (ids.length === 0) return empty

  const { rows } = await load()
  const set = new Set(ids)
  const mine = rows.filter((r) => set.has(r.id))
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
