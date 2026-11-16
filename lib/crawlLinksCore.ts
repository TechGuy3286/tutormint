// lib/crawlLinksCore.ts
//
// Crawlable paths to every open tuition (owner, 16 Nov 2026) — the PURE rules,
// shared by the pages and scripts/test-seo-crawl.ts:
//
//   - numbered page links (?page=2, 3 …) as real <a href> on the city pages and
//     /browse/tuitions, so a crawler reaches every open tuition without "Load more";
//   - the nearest other cities that have open tuitions, for "Nearby cities";
//   - whether a city name is KNOWN (it has a page, even with no open tuition).

import { orderCitiesByDistance } from '@/lib/cityDistance'

/**
 * The page numbers to link. Every page when there are at most `all` of them
 * (the usual case — Lahore's ~20), else the first, the last and a window of
 * `around` either side of the current page, with null where numbers are skipped.
 */
export function pageLinkNumbers(page: number, pages: number, all = 60, around = 3): (number | null)[] {
  const n = Math.max(1, Math.floor(pages))
  const p = Math.min(Math.max(1, Math.floor(page)), n)
  if (n <= all) return Array.from({ length: n }, (_, i) => i + 1)
  const keep = new Set<number>([1, n])
  for (let i = p - around; i <= p + around; i++) if (i >= 1 && i <= n) keep.add(i)
  const sorted = [...keep].sort((a, b) => a - b)
  const out: (number | null)[] = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push(null)
    out.push(sorted[i])
  }
  return out
}

/** How many pages a list of `total` items takes at `size` a page (at least 1). */
export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, size)))
}

/** `path` for page n: the clean address for page 1, ?page=n after it. Keeps
 *  other query parameters given in `params`. */
export function pageHref(path: string, n: number, params: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v && k !== 'page') q.set(k, v)
  if (n > 1) q.set('page', String(n))
  const s = q.toString()
  return s ? `${path}?${s}` : path
}

/** The nearest cities to `city` among `withOpen` (cities that have open
 *  tuitions), nearest first; the city itself is left out. */
export function nearbyCities<T extends { city: string }>(city: string, withOpen: T[], max = 8): T[] {
  const byName = new Map(withOpen.map((c) => [c.city.toLowerCase(), c]))
  return orderCitiesByDistance([city], withOpen.map((c) => c.city))
    .slice(0, max)
    .map((name) => byName.get(name.toLowerCase())!)
    .filter(Boolean)
}

/** The known city whose URL segment this is, or null. `known` = every city in
 *  Locations plus every city a tuition was ever saved with. */
export function knownCityForSegment(segment: string, known: string[], segmentOf: (c: string) => string): string | null {
  const s = (segment ?? '').trim().toLowerCase()
  if (!s) return null
  for (const c of known) if (c && segmentOf(c) === s) return c
  return null
}
