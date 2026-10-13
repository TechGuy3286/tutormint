import 'server-only'

// lib/areaAliases.ts
//
// The approved area aliases, read once and shared (owner, 13 Oct 2026). The
// table is world-readable reference data (like location_areas), so the public
// client reads it. Cached ten minutes and cleared the moment staff approve or
// take back an alias (AREA_ALIAS_TAG); the hub pages and sitemaps read it FRESH,
// so approving an alias re-evaluates its hub at once.
//
// Tolerant: before migration 166 (or on any read error) there are simply no
// aliases, and everything behaves as it did.

import { unstable_cache } from 'next/cache'

import { createPublicClient } from '@/lib/supabase/public'
import { pageAll } from '@/lib/pageAll'
import { areaSpellings, buildAliasIndex, canonAreaList, type AliasRow, type AreaAliasIndex } from '@/lib/areaAliasCore'

export const AREA_ALIAS_TAG = 'area-aliases'

type One = { name: string } | { name: string }[] | null
const first = (v: One) => (Array.isArray(v) ? v[0] : v)?.name ?? ''

export async function loadAliasRowsFresh(): Promise<AliasRow[]> {
  try {
    const db = createPublicClient()
    const rows = (await pageAll((from, to) =>
      db
        .from('location_area_aliases')
        .select('id, raw, location_cities(name), location_areas(name)')
        .is('removed_at', null)
        .order('id')
        .range(from, to),
    )) as unknown as { raw: string; location_cities: One; location_areas: One }[]
    return rows
      .map((r) => ({ city: first(r.location_cities), raw: r.raw, area: first(r.location_areas) }))
      .filter((r) => r.city && r.raw && r.area)
  } catch {
    return []
  }
}

const cachedRows = unstable_cache(loadAliasRowsFresh, ['area-alias-rows-v1'], { revalidate: 600, tags: [AREA_ALIAS_TAG] })

export async function loadAliasRows(opts: { fresh?: boolean } = {}): Promise<AliasRow[]> {
  return opts.fresh ? loadAliasRowsFresh() : cachedRows()
}

/** { cityLower: { areaKey: curatedName } } */
export async function loadAreaAliases(opts: { fresh?: boolean } = {}): Promise<AreaAliasIndex> {
  return buildAliasIndex(await loadAliasRows(opts))
}

/** Every saved spelling an area filter should match (the name + its aliases). */
export async function spellingsForArea(city: string | null | undefined, area: string | null | undefined): Promise<string[]> {
  return areaSpellings(await loadAliasRows(), city, area)
}

/**
 * A tutor card's areas with each alias shown as its curated name, repeats
 * removed. The saved rows are untouched; this is only what the card shows.
 */
export async function withCanonAreas<T extends { city?: string | null; cities?: string[] | null; area?: string | null; areas?: string[] | null }>(
  tutors: T[],
): Promise<T[]> {
  if (tutors.length === 0) return tutors
  const index = await loadAreaAliases()
  if (Object.keys(index).length === 0) return tutors
  return tutors.map((t) => {
    const cities = [t.city ?? null, ...(t.cities ?? [])]
    const areas = t.areas ? canonAreaList(index, cities, t.areas) : t.areas
    const area = t.area ? (canonAreaList(index, cities, [t.area])[0] ?? t.area) : t.area
    return { ...t, areas, area }
  })
}
