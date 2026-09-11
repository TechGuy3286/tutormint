import 'server-only'

// lib/locationsAdmin.ts
//
// The free-text locations in use that are NOT in the curated list (owner,
// 11 Sep 2026). city/area on jobs, profiles and tutor_profiles are plain
// strings; a member whose locality is not one of the 23 cities types their own,
// and it is preserved verbatim. This surfaces those free-text values so they can
// be REVIEWED and PROMOTED later — promoting one is a plain insert into
// location_cities / location_areas (migration 73), after which it stops
// appearing here.
//
// Computed live from the real columns rather than mirrored into a separate
// table, so it can never miss a write path or drift: it is exactly "every
// city/area string in use minus the curated set". Read through the service-role
// client (profiles is not public-readable), so it is admin-only by construction.

import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildCityAreaMap,
  isCuratedCity,
  isCuratedArea,
  type CityAreaMap,
} from '@/lib/cityAreasCore'

export type UnmappedLocation = {
  kind: 'city' | 'area'
  value: string
  /** For an area, the city it was typed under (null when the city is blank). */
  cityContext: string | null
  /** How many jobs/profiles/tutor rows carry this free-text value. */
  count: number
}

type Admin = NonNullable<ReturnType<typeof createAdminClient>>

async function loadCuratedMap(admin: Admin): Promise<CityAreaMap> {
  const [{ data: cityRows }, { data: areaRows }] = await Promise.all([
    admin.from('location_cities').select('id, name, sort_order'),
    admin.from('location_areas').select('name, city_id'),
  ])
  const idToName = new Map((cityRows ?? []).map((c) => [c.id as number, c.name as string]))
  return buildCityAreaMap({
    cities: (cityRows ?? []).map((c) => ({ name: c.name as string, sort_order: (c.sort_order as number) ?? 100 })),
    areas: (areaRows ?? []).map((a) => ({ city: idToName.get(a.city_id as number) ?? '', name: a.name as string })),
  })
}

/**
 * Every free-text (non-curated) city and area in use across jobs, tutor_profiles
 * and profiles, with a count, most-used first. Empty when the service role is
 * unavailable.
 */
export async function unmappedLocations(): Promise<UnmappedLocation[]> {
  const admin = createAdminClient()
  if (!admin) return []

  const map = await loadCuratedMap(admin)

  const [{ data: jobs }, { data: tutors }, { data: profs }] = await Promise.all([
    admin.from('jobs').select('city, area'),
    admin.from('tutor_profiles').select('city, area'),
    admin.from('profiles').select('city, area'),
  ])
  const rows = [...(jobs ?? []), ...(tutors ?? []), ...(profs ?? [])] as {
    city: string | null
    area: string | null
  }[]

  const cityCounts = new Map<string, number>()
  const areaCounts = new Map<string, { value: string; city: string | null; n: number }>()

  for (const r of rows) {
    const city = (r.city ?? '').trim()
    const area = (r.area ?? '').trim()
    if (city && !isCuratedCity(map, city)) {
      cityCounts.set(city, (cityCounts.get(city) ?? 0) + 1)
    }
    if (area && !isCuratedArea(map, city, area)) {
      const key = `${area.toLowerCase()}|${city.toLowerCase()}`
      const cur = areaCounts.get(key) ?? { value: area, city: city || null, n: 0 }
      cur.n += 1
      areaCounts.set(key, cur)
    }
  }

  const out: UnmappedLocation[] = []
  for (const [value, count] of cityCounts) out.push({ kind: 'city', value, cityContext: null, count })
  for (const { value, city, n } of areaCounts.values())
    out.push({ kind: 'area', value, cityContext: city, count: n })

  out.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
  return out
}
