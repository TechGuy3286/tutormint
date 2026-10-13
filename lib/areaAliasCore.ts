// lib/areaAliasCore.ts
//
// PURE rules for area aliases (owner, 13 Oct 2026). Staff say a typed area is
// the same as a curated one (Locations → "Same as existing area"); from then on
// the typed text COUNTS AS the curated area everywhere — filters, hubs, labels,
// sitemaps — while the text saved on the tuition or profile is never rewritten.
//
// An index is plain data (it crosses the server cache and the client boundary):
//   { "karachi": { "liaqatbad": "Liaqatabad" } }
// keyed by the lower-case city, then by areaKey(typed value).

import { areaKey, type CityAliases } from './areaHubCore'

export type AreaAliasIndex = Record<string, CityAliases>

export type AliasRow = { city: string; raw: string; area: string }

export function buildAliasIndex(rows: AliasRow[]): AreaAliasIndex {
  const out: AreaAliasIndex = {}
  for (const r of rows) {
    const city = (r.city ?? '').trim().toLowerCase()
    const key = areaKey(r.raw, r.city)
    if (!city || !key || !r.area) continue
    ;(out[city] ??= {})[key] = r.area
  }
  return out
}

const cityKey = (c: string | null | undefined) => (c ?? '').trim().toLowerCase()

/**
 * The area as it should be SHOWN and COUNTED: the curated name when the typed
 * value has an approved alias under its city, else the value as typed.
 */
export function canonArea(index: AreaAliasIndex | null | undefined, city: string | null | undefined, raw: string | null | undefined): string {
  const typed = (raw ?? '').trim()
  if (!typed || !index) return typed
  const hit = index[cityKey(city)]?.[areaKey(typed, city)]
  return hit ?? typed
}

/** The same, when the city is not known: an alias under any ONE city decides;
 *  the same text aliased to different areas in two cities stays as typed. */
export function canonAreaAnyCity(index: AreaAliasIndex | null | undefined, cities: (string | null | undefined)[], raw: string | null | undefined): string {
  const typed = (raw ?? '').trim()
  if (!typed || !index) return typed
  const hits = new Set<string>()
  for (const c of cities) {
    const hit = index[cityKey(c)]?.[areaKey(typed, c)]
    if (hit) hits.add(hit)
  }
  return hits.size === 1 ? [...hits][0] : typed
}

/**
 * A list of areas with each alias replaced by its curated name and repeats
 * removed — so a tutor who saved "DHA" and "D.H.A" (aliased to DHA) shows DHA
 * once. Order is first appearance.
 */
export function canonAreaList(index: AreaAliasIndex | null | undefined, cities: (string | null | undefined)[], areas: (string | null | undefined)[] | null | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const a of areas ?? []) {
    const name = canonAreaAnyCity(index, cities, a)
    const k = name.toLowerCase()
    if (!name || seen.has(k)) continue
    seen.add(k)
    out.push(name)
  }
  return out
}

/**
 * Every typed spelling that counts as one curated area in a city — what an area
 * FILTER matches: the curated name itself plus each approved alias.
 */
export function areaSpellings(rows: AliasRow[], city: string | null | undefined, wanted: string | null | undefined): string[] {
  const want = (wanted ?? '').trim()
  if (!want) return []
  const c = cityKey(city)
  const out = [want]
  // The filter value may itself be an alias ("Liaqatbad" in a shared link).
  const target = rows.find((r) => cityKey(r.city) === c && areaKey(r.raw, r.city) === areaKey(want, city))?.area ?? want
  if (target.toLowerCase() !== want.toLowerCase()) out.push(target)
  for (const r of rows) {
    if (c && cityKey(r.city) !== c) continue
    if (r.area.toLowerCase() !== target.toLowerCase()) continue
    if (!out.some((o) => o.toLowerCase() === r.raw.trim().toLowerCase())) out.push(r.raw.trim())
  }
  return out
}
