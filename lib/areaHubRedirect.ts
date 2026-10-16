// lib/areaHubRedirect.ts
//
// The 301 for an area hub address that was merged into another (owner, 13 Oct
// 2026): /tuition-jobs/lahore/dha-lahore → /tuition-jobs/lahore/dha. Called by
// proxy.ts, because a page can only answer 308 and the owner asked for a 301.
//
// It reads ONE thing — the curated areas (Locations, world-readable) — through
// PostgREST with the publishable key, and keeps the answer in memory for one
// minute, so a hub request costs no query most of the time. The rule itself is
// lib/areaHubCore.hubSlugRedirect. Any failure answers null: the page renders
// (or redirects) as it would have, never an error.

import { areaKey, hubSlugRedirect, type CityAliases } from '@/lib/areaHubCore'
import { cityFromSegment } from '@/lib/slugs'

// One minute (was ten; owner, 16 Oct 2026): a merge on Locations should move
// its old hub address on almost at once. The page itself never waits for this.
const TTL_MS = 60_000
let cache: { at: number; byCity: Map<string, string[]>; aliases: Map<string, CityAliases> } | null = null

async function curated(): Promise<Map<string, string[]> | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.byCity
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!base || !key) return null
  try {
    const res = await fetch(`${base}/rest/v1/location_areas?select=name,location_cities(name)&removed_at=is.null&limit=5000`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
    })
    if (!res.ok) return cache?.byCity ?? null
    const rows = (await res.json()) as { name: string; location_cities: { name: string } | { name: string }[] | null }[]
    const byCity = new Map<string, string[]>()
    for (const r of rows) {
      const c = Array.isArray(r.location_cities) ? r.location_cities[0] : r.location_cities
      const city = c?.name?.toLowerCase()
      if (city) (byCity.get(city) ?? byCity.set(city, []).get(city)!).push(r.name)
    }
    // Approved aliases (Locations → "Same as existing area"): a hub address made
    // from a typed spelling moves to the curated area's hub too.
    const aliases = new Map<string, CityAliases>()
    try {
      const ar = await fetch(
        `${base}/rest/v1/location_area_aliases?select=raw,location_cities(name),location_areas(name)&removed_at=is.null&limit=5000`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store' },
      )
      if (ar.ok) {
        type One = { name: string } | { name: string }[] | null
        const first = (v: One) => (Array.isArray(v) ? v[0] : v)?.name ?? ''
        for (const r of (await ar.json()) as { raw: string; location_cities: One; location_areas: One }[]) {
          const city = first(r.location_cities)
          const area = first(r.location_areas)
          const k = areaKey(r.raw, city)
          if (!city || !area || !k) continue
          const m = aliases.get(city.toLowerCase()) ?? {}
          m[k] = area
          aliases.set(city.toLowerCase(), m)
        }
      }
    } catch {
      /* the curated list alone still redirects the merged spellings */
    }
    cache = { at: Date.now(), byCity, aliases }
    return byCity
  } catch {
    return cache?.byCity ?? null
  }
}

const HUB_PATH = /^\/tuition-jobs\/([^/]+)\/([^/]+)\/?$/

/** The path a merged area hub address moved to, or null when it stays where it is. */
export async function areaHubRedirectPath(pathname: string): Promise<string | null> {
  const m = HUB_PATH.exec(pathname)
  if (!m || m[1] === 'school') return null
  const [, citySlug, segment] = m
  const city = cityFromSegment(citySlug)
  if (!city) return null
  const byCity = await curated()
  const list = byCity?.get(city.toLowerCase())
  if (!list || list.length === 0) return null
  const to = hubSlugRedirect(city, decodeURIComponent(segment).toLowerCase(), list, cache?.aliases.get(city.toLowerCase()))
  return to ? `/tuition-jobs/${citySlug}/${to}` : null
}
