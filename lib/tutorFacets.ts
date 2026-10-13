import 'server-only'

// lib/tutorFacets.ts
//
// The visible tutors, reduced to what the browse filters match on, and the
// dropdown options with counts (owner, 13 Oct 2026). Rules are pure
// (lib/tutorFacetsCore); this file only reads.
//
// The index is small (every listed tutor: cities, areas, subject ids) and is
// cached for five minutes; it is cleared with the landing cache whenever a
// tutor is listed or unlisted.

import { unstable_cache } from 'next/cache'

import { createPublicClient } from '@/lib/supabase/public'
import { createAdminClient } from '@/lib/supabase/admin'
import { LANDING_TAG } from '@/lib/landing'
import { pageAll, pageAllIn } from '@/lib/pageAll'
import { fetchTaxonomyTables, buildTaxonomy } from '@/lib/taxonomyBuild'
import { loadAreaAliases } from '@/lib/areaAliases'
import { facetsFor, type IndexedTutor, type TaxRow, type TutorFacets } from '@/lib/tutorFacetsCore'

type DirRow = { id: string; slug: string | null; city: string | null; cities: string[] | null; area: string | null; areas: string[] | null }

/** Every tutor in the public directory. Read with the public client — exactly
 *  what a visitor can see — except the subject links, which need the service role. */
export async function loadTutorIndexFresh(): Promise<IndexedTutor[]> {
  const db = createPublicClient()
  const rows = (await pageAll((from, to) => db.from('tutor_directory').select('id, slug, city, cities, area, areas').order('id').range(from, to))) as DirRow[]
  if (rows.length === 0) return []
  const admin = createAdminClient()
  const links = admin
    ? ((await pageAllIn(
        rows.map((r) => r.id),
        (ids, from, to) => admin.from('tutor_subjects').select('tutor_id, master_id').in('tutor_id', ids).order('tutor_id').order('master_id').range(from, to),
      )) as { tutor_id: string; master_id: number }[])
    : []
  const by = new Map<string, number[]>()
  for (const l of links) (by.get(l.tutor_id) ?? by.set(l.tutor_id, []).get(l.tutor_id)!).push(l.master_id)
  const uniq = (list: (string | null | undefined)[]) => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const v of list) {
      const s = (v ?? '').trim()
      if (!s || seen.has(s.toLowerCase())) continue
      seen.add(s.toLowerCase())
      out.push(s)
    }
    return out
  }
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    cities: uniq([r.city, ...(r.cities ?? [])]),
    areas: uniq([...(r.areas ?? []), r.area]),
    masterIds: by.get(r.id) ?? [],
  }))
}

const cachedIndex = unstable_cache(loadTutorIndexFresh, ['tutor-filter-index-v1'], { revalidate: 300, tags: [LANDING_TAG] })

type Tax = { rows: TaxRow[]; categories: string[]; levels: Record<string, string[]> }

const cachedTax = unstable_cache(
  async (): Promise<Tax> => {
    const tables = await fetchTaxonomyTables(createPublicClient())
    if (!tables) return { rows: [], categories: [], levels: {} }
    const built = buildTaxonomy(tables)
    const rows = built.rows.filter((r) => !r.legacy).map((r) => ({ id: r.id, category: r.category, level: r.level, subject: r.subject }))
    const categories = Object.keys(built.tree)
    const levels: Record<string, string[]> = {}
    for (const c of categories) levels[c] = Object.keys(built.tree[c] ?? {})
    return { rows, categories, levels }
  },
  ['tutor-filter-taxonomy-v1'],
  { revalidate: 3600 },
)

/**
 * The dropdown options for the tutor browse page under the current filters, or
 * null when they cannot be worked out — the filter bar then shows its full
 * lists, as it did before.
 */
export async function tutorFacets(filters: { city?: string | null; area?: string | null; masterIds?: number[] | null }): Promise<TutorFacets | null> {
  try {
    const [index, tax, aliases] = await Promise.all([cachedIndex(), cachedTax(), loadAreaAliases()])
    if (index.length === 0 || tax.rows.length === 0) return null
    return facetsFor(index, tax.rows, filters, aliases, { categories: tax.categories, levels: tax.levels })
  } catch {
    return null
  }
}
