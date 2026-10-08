import 'server-only'

// ONE smart search engine — the server half (owner, 8 Oct 2026). Loads the
// dictionary (cities, levels, subjects, schools, Search words) once per ten
// minutes, parses a query with lib/smartSearchCore, and turns the parts into the
// filters the browse pages use: master ids for a subject (scoped to a named
// level), level names for a level on its own, the city. Also logs every search
// that found nothing (search_unmet) for the Overview to-do.

import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchTaxonomyTables } from '@/lib/taxonomyBuild'
import { pageAll } from '@/lib/pageAll'
import { CITY_COORDS } from '@/lib/cityDistance'
import { parseQuery, understood, type Dict, type Parsed } from '@/lib/smartSearchCore'
import { maskTuitionText } from '@/lib/maskTuition'

export const SMART_SEARCH_TAG = 'smart-search'
const SCHOOL_LEVEL = 'admission-test-prep'

type Loaded = Dict & {
  /** Non-legacy master rows: id, level NAME, subject slug. */
  master: { id: number; level: string; subject: string | null }[]
}

export const loadSearchDict = unstable_cache(
  async (): Promise<Loaded> => {
    const admin = createAdminClient()
    if (!admin) return { cities: Object.keys(CITY_COORDS), levels: [], subjects: [], aliases: [], master: [], builtin: true }
    const [tables, cityRows, aliasRows] = await Promise.all([
      fetchTaxonomyTables(admin),
      pageAll((from, to) => admin.from('location_cities').select('id, name').order('id').range(from, to)),
      pageAll((from, to) => admin.from('taxonomy_aliases').select('id, kind, slug, alias').order('id').range(from, to)),
    ])
    const t = tables ?? { categories: [], levels: [], subjects: [], master: [] }
    const catName = new Map(t.categories.map((c) => [c.slug, c.name]))
    const liveLevels = t.levels.filter((l) => !l.legacy)
    const levelBySlug = new Map(liveLevels.map((l) => [l.slug, l]))
    const levels = liveLevels
      // The implicit grade of a no-grade level is the level itself; it is
      // reached by its schools, not as a level word.
      .filter((l) => l.slug !== SCHOOL_LEVEL)
      .map((l) => ({ slug: l.slug, name: l.name, category: catName.get(l.category_slug) ?? '' }))
    const liveMaster = t.master.filter((m) => levelBySlug.has(m.level_slug))
    const schoolSlugs = new Set(liveMaster.filter((m) => m.level_slug === SCHOOL_LEVEL && m.subject_slug).map((m) => m.subject_slug as string))
    schoolSlugs.delete('other')
    const usedSubjects = new Set(liveMaster.map((m) => m.subject_slug).filter(Boolean) as string[])
    const subjects = t.subjects
      .filter((s) => usedSubjects.has(s.slug) && s.slug !== 'other')
      .map((s) => ({ slug: s.slug, name: s.name, school: schoolSlugs.has(s.slug) }))
    const cities = [...new Set([...cityRows.map((c) => c.name as string), ...Object.keys(CITY_COORDS)])]
    return {
      builtin: false,
      cities,
      levels,
      subjects,
      aliases: aliasRows
        .filter((a) => a.kind === 'subject' || a.kind === 'level')
        .map((a) => ({ kind: a.kind as 'subject' | 'level', slug: a.slug as string, alias: a.alias as string })),
      master: liveMaster.map((m) => ({ id: m.id, level: levelBySlug.get(m.level_slug)!.name, subject: m.subject_slug })),
    }
  },
  ['smart-search-dict-v1'],
  { revalidate: 600, tags: [SMART_SEARCH_TAG] },
)

export type SmartResolved = {
  parsed: Parsed
  /** Subject (or school) master ids, scoped to the named level when there is one. */
  masterIds: number[] | null
  /** A level named WITHOUT a subject — its level names (tuitions) and all its
   *  master ids (tutors). */
  levelNames: string[] | null
  levelMasterIds: number[] | null
  /** Anything understood at all — otherwise the caller keeps its literal text search. */
  understood: boolean
}

export function resolveWith(dict: Loaded, parsed: Parsed): SmartResolved {
  const levelSet = new Set(parsed.levels)
  let masterIds: number[] | null = null
  let levelNames: string[] | null = null
  let levelMasterIds: number[] | null = null
  if (parsed.subject) {
    const all = dict.master.filter((m) => m.subject === parsed.subject!.slug)
    const scoped = levelSet.size ? all.filter((m) => levelSet.has(m.level)) : all
    masterIds = (scoped.length ? scoped : all).map((m) => m.id)
  } else if (parsed.school && levelSet.size === 0) {
    // A school on its own is its admission-test-prep subject. With a level
    // named too ("primary … beaconhouse") the school is context, not a filter.
    masterIds = dict.master.filter((m) => m.subject === parsed.school!.slug).map((m) => m.id)
  }
  if (!parsed.subject && levelSet.size) {
    levelNames = [...levelSet]
    levelMasterIds = dict.master.filter((m) => levelSet.has(m.level)).map((m) => m.id)
  }
  return { parsed, masterIds, levelNames, levelMasterIds, understood: understood(parsed) }
}

export async function resolveSmartQuery(q: string): Promise<SmartResolved> {
  const dict = await loadSearchDict()
  return resolveWith(dict, parseQuery(q, dict))
}

/** Every "nothing found" search, for the Overview to-do. Never throws. */
export async function logUnmetSearch(input: { query: string; surface: string; parsed: Parsed | null; role: string | null }): Promise<void> {
  try {
    const admin = createAdminClient()
    if (!admin) return
    // A phone number or email typed into a search is masked before it is kept.
    const q = maskTuitionText(input.query.trim().slice(0, 200)).text
    if (q.length < 2) return
    // One row per identical search per surface per hour — a refreshing page or a
    // load-more must not count the same miss many times.
    const since = new Date(Date.now() - 3600_000).toISOString()
    const { count } = await admin
      .from('search_unmet')
      .select('id', { count: 'exact', head: true })
      .eq('query', q)
      .eq('surface', input.surface)
      .gte('created_at', since)
    if ((count ?? 0) > 0) return
    await admin.from('search_unmet').insert({
      query: q,
      surface: input.surface,
      city: input.parsed?.city ?? null,
      subject: input.parsed?.subject?.name ?? null,
      level: input.parsed?.levelLabel ?? null,
      school: input.parsed?.school?.name ?? null,
      role: input.role,
    })
  } catch {
    /* logging must never break a search */
  }
}
