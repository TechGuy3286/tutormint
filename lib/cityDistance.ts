// PR85 (Part B.3) — approximate coordinates for every city in the platform's
// city list, so the tuition feed's third fallback level can order OTHER cities
// by distance from the tutor's own city and show the nearest ones that have
// tuitions. A code constant is fine (the owner) — location_cities carries no
// geo. Pure, so it is unit-tested and shared by the feed and its tests.
//
// A few common free-text cities members actually use (not in the curated 26,
// e.g. Nankana Sahib) are included too; an unknown city has no coordinate and
// sorts last rather than being dropped.
//
// Since 20 Oct 2026 every Pakistani city and town is on the list: the
// coordinates of the new ones come from GeoNames (lib/pkCityData.ts); the hand
// values for the existing 26 (lib/cityCoordsHand.ts) win.

import { HAND_CITY_COORDS, type LatLng } from '@/lib/cityCoordsHand'
import { PK_CITIES } from '@/lib/pkCityData'

export type { LatLng }

export const CITY_COORDS: Record<string, LatLng> = {
  ...Object.fromEntries(PK_CITIES.map((c) => [c.name, { lat: c.lat, lng: c.lng }])),
  ...HAND_CITY_COORDS,
}

function keyFor(name: string | null | undefined): string | null {
  const n = (name ?? '').trim()
  if (!n) return null
  if (CITY_COORDS[n]) return n
  // case-insensitive fallback
  const lower = n.toLowerCase()
  for (const k of Object.keys(CITY_COORDS)) if (k.toLowerCase() === lower) return k
  return null
}

export function cityCoord(name: string | null | undefined): LatLng | null {
  const k = keyFor(name)
  return k ? CITY_COORDS[k] : null
}

/** Great-circle distance in km (haversine). */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/**
 * Order `candidates` by distance from the NEAREST of `fromCities`, ascending.
 * Candidates equal to one of `fromCities` (case-insensitive) are dropped. A
 * candidate with no known coordinate sorts after all known ones (kept, not
 * dropped, so a valid but uncharted city can still appear if nothing closer
 * has tuitions). Stable within equal distances by name.
 */
export function orderCitiesByDistance(fromCities: string[], candidates: string[]): string[] {
  const fromKeys = new Set(fromCities.map((c) => (c ?? '').trim().toLowerCase()).filter(Boolean))
  const fromCoords = fromCities.map(cityCoord).filter((c): c is LatLng => c != null)

  const scored = candidates
    .filter((c) => c && c.trim() && !fromKeys.has(c.trim().toLowerCase()))
    .map((c) => {
      const coord = cityCoord(c)
      let dist = Number.POSITIVE_INFINITY
      if (coord && fromCoords.length > 0) dist = Math.min(...fromCoords.map((f) => distanceKm(f, coord)))
      return { city: c, dist }
    })

  scored.sort((a, b) => a.dist - b.dist || a.city.localeCompare(b.city))
  return scored.map((s) => s.city)
}
