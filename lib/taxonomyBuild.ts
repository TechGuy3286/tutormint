// lib/taxonomyBuild.ts
//
// The taxonomy fetch + pure derivation, split out of lib/taxonomy.ts so both
// the live client path and the live test read the SAME code — and so the test
// can inject a plain node Supabase client without pulling in the browser client.
//
// Why the paginator exists: taxonomy_master is 4,500+ rows (13 categories × 29
// grades × up to 1,475 combinations, PLUS every retired row kept valid for
// existing jobs). Supabase caps a single PostgREST response at max-rows (1000),
// so a plain `.select()` returns an arbitrary 1,000-row slice — which built the
// tree from whichever non-legacy rows happened to land in that slice (the "only
// Primary shows" bug). We MUST page through with a stable order.

import type { SupabaseClient } from '@supabase/supabase-js'

export type TaxonomyNode = Record<string, Record<string, string[]>>

export type TaxonomyRow = {
  id: number
  category: string
  level: string
  subject: string | null
  isLevelLeaf: boolean
  /** A retired level. Migration 80 replaced the whole taxonomy and flagged every
   *  prior level legacy: still VALID on existing job/tutor rows (they render by
   *  id and match by master-id intersection), but hidden from every picker — the
   *  tree and the pickers are built from non-legacy rows only. Reachable by id
   *  for rendering saved labels. */
  legacy: boolean
}

type CategoryRaw = { slug: string; name: string; sort_order: number | null }
type LevelRaw = { slug: string; category_slug: string; name: string; sort_order: number | null; legacy: boolean | null }
type SubjectRaw = { slug: string; name: string }
type MasterRaw = { id: number; category_slug: string; level_slug: string; subject_slug: string | null; leaf_type: string | null }

export type TaxonomyTables = {
  categories: CategoryRaw[]
  levels: LevelRaw[]
  subjects: SubjectRaw[]
  master: MasterRaw[]
}

const PAGE = 1000

/**
 * Read one table completely, defeating the PostgREST max-rows cap by requesting
 * fixed-size ranges under a stable `order` until a short page comes back. The
 * order only has to be stable+total for the paging to be correct; the caller
 * re-sorts for display.
 */
async function pageAll<T>(
  make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[] | null; error: unknown }> {
  const all: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make(from, from + PAGE - 1)
    if (error) return { data: null, error }
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return { data: all, error: null }
}

/** Fetch all four taxonomy tables in full (paginated). Returns null on error. */
export async function fetchTaxonomyTables(
  supabase: Pick<SupabaseClient, 'from'>,
): Promise<TaxonomyTables | null> {
  const [categories, levels, subjects, master] = await Promise.all([
    pageAll<CategoryRaw>((f, t) =>
      supabase.from('taxonomy_categories').select('slug, name, sort_order').order('slug').range(f, t),
    ),
    pageAll<LevelRaw>((f, t) =>
      supabase.from('taxonomy_levels').select('slug, category_slug, name, sort_order, legacy').order('slug').range(f, t),
    ),
    pageAll<SubjectRaw>((f, t) =>
      supabase.from('taxonomy_subjects').select('slug, name').order('slug').range(f, t),
    ),
    pageAll<MasterRaw>((f, t) =>
      supabase.from('taxonomy_master').select('id, category_slug, level_slug, subject_slug, leaf_type').order('id').range(f, t),
    ),
  ])

  const failed = [categories, levels, subjects, master].find((r) => r.error)
  if (failed?.error) {
    console.error('Error fetching taxonomy:', failed.error)
    return null
  }

  return {
    categories: categories.data ?? [],
    levels: levels.data ?? [],
    subjects: subjects.data ?? [],
    master: master.data ?? [],
  }
}

/**
 * Resolve master's slugs to display names and shape the three tiers. The tree
 * (every picker's source) is built from NON-LEGACY rows only, because it keys by
 * display name — a retired grade sharing a name with a live one would otherwise
 * merge their subject lists. `rows` keeps ALL rows so labels/selection can look
 * a retired row up by id.
 */
export function buildTaxonomy(t: TaxonomyTables): { rows: TaxonomyRow[]; tree: TaxonomyNode } {
  const categoryName = new Map<string, string>()
  const categoryOrder = new Map<string, number>()
  for (const c of t.categories) {
    categoryName.set(c.slug, c.name)
    categoryOrder.set(c.slug, c.sort_order ?? 0)
  }

  const levelName = new Map<string, string>()
  const levelOrder = new Map<string, number>()
  const levelLegacy = new Map<string, boolean>()
  for (const l of t.levels) {
    levelName.set(l.slug, l.name)
    levelOrder.set(l.slug, l.sort_order ?? 0)
    levelLegacy.set(l.slug, !!l.legacy)
  }

  const subjectName = new Map<string, string>()
  for (const s of t.subjects) subjectName.set(s.slug, s.name)

  // Keep master in the taxonomy's own sort order, not alphabetical, so the
  // dropdowns read in authored order.
  const ordered = [...t.master].sort((a, b) => {
    const c = (categoryOrder.get(a.category_slug) ?? 0) - (categoryOrder.get(b.category_slug) ?? 0)
    if (c !== 0) return c
    return (levelOrder.get(a.level_slug) ?? 0) - (levelOrder.get(b.level_slug) ?? 0)
  })

  const rows: TaxonomyRow[] = []
  for (const m of ordered) {
    const category = categoryName.get(m.category_slug)
    const level = levelName.get(m.level_slug)
    if (!category || !level) continue
    rows.push({
      id: m.id,
      category,
      level,
      subject: m.subject_slug ? subjectName.get(m.subject_slug) ?? null : null,
      isLevelLeaf: m.leaf_type === 'level' || m.subject_slug === null,
      legacy: levelLegacy.get(m.level_slug) ?? false,
    })
  }

  const tree: TaxonomyNode = {}
  for (const r of rows) {
    if (r.legacy) continue
    if (!tree[r.category]) tree[r.category] = {}
    if (!tree[r.category][r.level]) tree[r.category][r.level] = []
    if (r.subject && !tree[r.category][r.level].includes(r.subject)) {
      tree[r.category][r.level].push(r.subject)
    }
  }

  return { rows, tree }
}
