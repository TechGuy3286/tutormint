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

type Row = { category: string; level: string; subject: string | null }

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
      supabase.from('taxonomy_levels').select('slug, category_slug, name, sort_order'),
      supabase.from('taxonomy_subjects').select('slug, name'),
      supabase.from('taxonomy_master').select('category_slug, level_slug, subject_slug'),
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
    for (const l of levels.data ?? []) {
      levelName.set(l.slug, l.name)
      levelOrder.set(l.slug, l.sort_order ?? 0)
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
      rows.push({ category, level, subject: m.subject_slug ? subjectName.get(m.subject_slug) ?? null : null })
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

/** Second tier: level names ("Level 2") within one category. */
export async function fetchGradesForLevel(level1: string): Promise<string[]> {
  const { rows } = await load()
  return Array.from(new Set(rows.filter((r) => r.category === level1).map((r) => r.level)))
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
