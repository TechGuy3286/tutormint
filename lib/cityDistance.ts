// PR85 (Part B.3) — approximate coordinates for every city in the platform's
// city list, so the tuition feed's third fallback level can order OTHER cities
// by distance from the tutor's own city and show the nearest ones that have
// tuitions. A code constant is fine (the owner) — location_cities carries no
// geo. Pure, so it is unit-tested and shared by the feed and its tests.
//
// A few common free-text cities members actually use (not in the curated 23,
// e.g. Nankana Sahib) are included too; an unknown city has no coordinate and
// sorts last rather than being dropped.

export type LatLng = { lat: number; lng: number }

export const CITY_COORDS: Record<string, LatLng> = {
  Lahore: { lat: 31.5204, lng: 74.3587 },
  Karachi: { lat: 24.8607, lng: 67.0011 },
  Islamabad: { lat: 33.6844, lng: 73.0479 },
  Rawalpindi: { lat: 33.5651, lng: 73.0169 },
  Abbottabad: { lat: 34.1688, lng: 73.2215 },
  Bahawalpur: { lat: 29.3956, lng: 71.6836 },
  'Dera Ghazi Khan': { lat: 30.0459, lng: 70.6345 },
  Faisalabad: { lat: 31.4504, lng: 73.135 },
  Gujranwala: { lat: 32.1877, lng: 74.1945 },
  Gujrat: { lat: 32.5731, lng: 74.0789 },
  Hyderabad: { lat: 25.396, lng: 68.3578 },
  Jhelum: { lat: 32.9425, lng: 73.7257 },
  Larkana: { lat: 27.559, lng: 68.2123 },
  Mardan: { lat: 34.1989, lng: 72.0231 },
  Mingora: { lat: 34.7795, lng: 72.3614 },
  Multan: { lat: 30.1575, lng: 71.5249 },
  Peshawar: { lat: 34.0151, lng: 71.5249 },
  Quetta: { lat: 30.1798, lng: 66.975 },
  Sahiwal: { lat: 30.6682, lng: 73.1114 },
  Sargodha: { lat: 32.0836, lng: 72.6711 },
  Sialkot: { lat: 32.4945, lng: 74.5229 },
  Sukkur: { lat: 27.7052, lng: 68.8574 },
  'Wah Cantt': { lat: 33.7973, lng: 72.7574 },
  // Common free-text cities members use that are not in the curated 23.
  'Nankana Sahib': { lat: 31.4492, lng: 73.7126 },
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
