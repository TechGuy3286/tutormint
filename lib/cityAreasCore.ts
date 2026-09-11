// lib/cityAreasCore.ts
//
// The PURE core of the city/area lists (owner, 11 Sep 2026) — no Supabase, no
// React — so the ordering, the area-dependent-on-city rule and the
// free-text/curated distinction are unit-testable without the database. The
// client fetch (lib/cityAreas.ts) and the admin review (lib/locationsAdmin.ts)
// both build on this.
//
// Cities and areas live in location_cities / location_areas (migration 73).
// city/area on jobs, profiles and tutor_profiles stay PLAIN STRINGS; a value not
// in these tables is free text, kept as-is and surfaced for review — never
// discarded.

export type CityAreaRows = {
  cities: { name: string; sort_order: number }[]
  /** area.name paired with its city's NAME (already resolved from city_id). */
  areas: { city: string; name: string }[]
}

export type CityAreaMap = {
  /** Cities ordered: sort_order first (the big-four pinned 1..4), then name. */
  cities: string[]
  /** City name → its areas, each list sorted alphabetically. */
  areasByCity: Record<string, string[]>
}

/** Build the ordered city list + the per-city area map from raw table rows. */
export function buildCityAreaMap(rows: CityAreaRows): CityAreaMap {
  const cities = [...rows.cities]
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map((c) => c.name)

  const areasByCity: Record<string, string[]> = {}
  for (const c of cities) areasByCity[c] = []
  for (const a of rows.areas) {
    ;(areasByCity[a.city] ??= []).push(a.name)
  }
  for (const k of Object.keys(areasByCity)) {
    areasByCity[k].sort((x, y) => x.localeCompare(y))
  }
  return { cities, areasByCity }
}

/** Case-insensitive lookup of a curated city's own areas — [] for an unknown
 *  city, so a city with no match NEVER inherits another city's areas. */
export function areasForCity(map: CityAreaMap, city: string | null | undefined): string[] {
  const c = (city ?? '').trim()
  if (!c) return []
  if (map.areasByCity[c]) return map.areasByCity[c]
  const key = Object.keys(map.areasByCity).find((k) => k.toLowerCase() === c.toLowerCase())
  return key ? map.areasByCity[key] : []
}

/** Is this city one of the curated 23 (case-insensitive)? */
export function isCuratedCity(map: CityAreaMap, city: string | null | undefined): boolean {
  const c = (city ?? '').trim().toLowerCase()
  return !!c && map.cities.some((x) => x.toLowerCase() === c)
}

/** Is this area curated FOR this city (case-insensitive)? A free-text area under
 *  a curated city, or any area under an unknown city, is not curated. */
export function isCuratedArea(
  map: CityAreaMap,
  city: string | null | undefined,
  area: string | null | undefined,
): boolean {
  const a = (area ?? '').trim().toLowerCase()
  if (!a) return false
  return areasForCity(map, city).some((x) => x.toLowerCase() === a)
}
