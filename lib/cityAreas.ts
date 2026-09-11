'use client'

// lib/cityAreas.ts
//
// The client fetch of the curated city/area lists, mirroring lib/taxonomy.ts:
// the whole set (23 cities, 249 areas — small) is read ONCE through the browser
// client, deduped in-flight, and cached for the page lifetime. Every city/area
// picker on the platform reads from here, so there is one source and no second
// list.

import { useEffect, useState } from 'react'

import { createClient } from '@/lib/supabase/client'
import { buildCityAreaMap, type CityAreaMap } from '@/lib/cityAreasCore'

const EMPTY: CityAreaMap = { cities: [], areasByCity: {} }

let cache: CityAreaMap | null = null
let inFlight: Promise<CityAreaMap> | null = null

export async function fetchCityAreas(): Promise<CityAreaMap> {
  if (cache) return cache
  if (inFlight) return inFlight
  inFlight = (async () => {
    const sb = createClient()
    const [{ data: cityRows }, { data: areaRows }] = await Promise.all([
      sb.from('location_cities').select('id, name, sort_order'),
      sb.from('location_areas').select('name, city_id'),
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
