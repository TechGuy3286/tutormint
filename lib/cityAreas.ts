'use client'

// lib/cityAreas.ts
//
// The client fetch of the curated city/area lists, mirroring lib/taxonomy.ts:
// the whole set (26 cities, 249 areas — small) is read ONCE through the browser
// client, deduped in-flight, and cached for the page lifetime. Every city/area
// picker on the platform reads from here, so there is one source and no second
// list.

import { useEffect, useState } from 'react'

import { getBrowserClient } from '@/lib/supabase/clientLazy'
import { buildCityAreaMap, type CityAreaMap } from '@/lib/cityAreasCore'

const EMPTY: CityAreaMap = { cities: [], areasByCity: {} }

let cache: CityAreaMap | null = null
let inFlight: Promise<CityAreaMap> | null = null

export async function fetchCityAreas(): Promise<CityAreaMap> {
  if (cache) return cache
  if (inFlight) return inFlight
  inFlight = (async () => {
    const sb = await getBrowserClient()
    const [{ data: cityRows }, { data: areaRows }] = await Promise.all([
      sb.from('location_cities').select('id, name, sort_order'),
      // A retired (merged) area is no longer offered (migration 169).
      sb.from('location_areas').select('name, city_id').is('removed_at', null),
    ])
    const idToName = new Map((cityRows ?? []).map((c) => [c.id as number, c.name as string]))
    const map = buildCityAreaMap({
      cities: (cityRows ?? []).map((c) => ({ name: c.name as string, sort_order: (c.sort_order as number) ?? 100 })),
      areas: (areaRows ?? []).map((a) => ({ city: idToName.get(a.city_id as number) ?? '', name: a.name as string })),
    })
    cache = map
    inFlight = null
    return map
  })()
  return inFlight
}

/** A just-added area shows in the pickers at once, without a reload. */
export function addAreaToCache(city: string, area: string): void {
  if (!cache) return
  const key = Object.keys(cache.areasByCity).find((c) => c.toLowerCase() === city.trim().toLowerCase()) ?? city.trim()
  const list = cache.areasByCity[key] ?? []
  if (list.some((a) => a.toLowerCase() === area.toLowerCase())) return
  cache = { ...cache, areasByCity: { ...cache.areasByCity, [key]: [...list, area].sort((a, b) => a.localeCompare(b)) } }
}

/** React hook: the city/area map, loaded once. Empty until it resolves. */
export function useCityAreas(): { map: CityAreaMap; loading: boolean } {
  const [map, setMap] = useState<CityAreaMap>(cache ?? EMPTY)
  const [loading, setLoading] = useState(!cache)

  useEffect(() => {
    if (cache) {
      setMap(cache)
      setLoading(false)
      return
    }
    let alive = true
    fetchCityAreas()
      .then((m) => {
        if (alive) {
          setMap(m)
          setLoading(false)
        }
      })
      .catch(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  return { map, loading }
}
