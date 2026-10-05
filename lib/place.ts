// lib/place.ts
//
// THE location builder (owner, 5 Oct 2026, "never repeat the city"). Area names
// in the owner's dataset and in free text often carry the city as a suffix —
// "Bahria Town Lahore", "DHA Karachi", "Gulberg, Lahore" — and joining that with
// the city column produced "Bahria Town Lahore, Lahore" on cards, pages, titles
// and in the AI brief. One pure function, used everywhere an area and a city are
// put side by side:
//
//   placeLabel('Bahria Town Lahore', 'Lahore') → 'Bahria Town, Lahore'
//   placeLabel('DHA', 'Lahore')                → 'DHA, Lahore'
//   placeLabel('Lahore', 'Lahore')             → 'Lahore'
//   placeLabel(null, 'Lahore')                 → 'Lahore'
//   placeLabel('DHA', null)                    → 'DHA'
//
// Pure, client-safe, no imports. Slugs and URLs never read this — they are
// minted once at posting and left alone.

const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ')

/**
 * The area with a trailing city name removed (case-insensitive, whole word,
 * optional comma/dash before it). Returns '' when the area IS the city.
 */
export function areaWithoutCity(area: string | null | undefined, city: string | null | undefined): string {
  const a = norm(area)
  const c = norm(city)
  if (!a) return ''
  if (!c) return a
  if (a.toLowerCase() === c.toLowerCase()) return ''
  const esc = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const stripped = a.replace(new RegExp(`[\\s,\\-–—]+${esc}$`, 'i'), '').trim()
  // "North Karachi", "New Karachi": the city is part of the area's own name —
  // stripping it would leave "North". The area is kept whole, and placeLabel()
  // then omits the city, so the city is still never repeated.
  if (stripped && /^(north|south|east|west|new|old|greater|central|upper|lower)$/i.test(stripped)) return a
  return stripped || ''
}

/** The area's own name already ENDS with the city and must stay whole ("North Karachi"). */
export function areaCarriesCity(area: string | null | undefined, city: string | null | undefined): boolean {
  const a = norm(area)
  const c = norm(city)
  if (!a || !c || a.toLowerCase() === c.toLowerCase()) return false
  const esc = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`[\\s,\\-–—]+${esc}$`, 'i').test(a) && areaWithoutCity(a, c) === a
}

/** "Area, City" with the city never repeated; whichever part exists on its own.
 *  An area that carries the city in its own name ("North Karachi") is shown
 *  alone — "North Karachi", never "North Karachi, Karachi". */
export function placeLabel(area: string | null | undefined, city: string | null | undefined): string {
  const c = norm(city)
  if (areaCarriesCity(area, c)) return norm(area)
  const a = areaWithoutCity(area, c)
  return [a, c].filter(Boolean).join(', ')
}

/**
 * Remove "X City, City" repeats from a sentence (titles and descriptions already
 * stored). Only the exact doubled form is touched: "<City>, <City>" → "<City>".
 */
export function dedupeCityInText(text: string, city: string): string {
  const c = norm(city)
  if (!c || !text) return text
  const esc = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`\\b${esc},\\s*${esc}\\b`, 'gi'), c)
}
