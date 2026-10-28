// lib/adminPagingCore.ts — admin lists load 25 at a time (owner, 28 Oct 2026).
//
// PURE. Every admin list (People, Applications, Follow-ups, Finance, Paid
// tutors, Payments, Locations, Unmet searches, Tuitions) works the same way:
// the SERVER filters, searches and counts the WHOLE list, then sends only the
// first `shown` rows. "Load more" asks the server for 25 more by raising `?n=` in
// the address (so the count, the filters and the search always describe the
// whole list, a refresh keeps what was open, and the back button returns to the
// same place). Nothing is filtered or counted in the browser.

export const ADMIN_PAGE_SIZE = 25
/** Never render more than this many rows at once, however high `?n=` is set. */
export const ADMIN_PAGE_MAX = 2000

/** How many rows to show, from the `?n=` value (25, 50, 75 …). */
export function shownCount(raw: string | string[] | null | undefined, size = ADMIN_PAGE_SIZE): number {
  const v = Array.isArray(raw) ? raw[0] : raw
  const n = Number.parseInt(String(v ?? ''), 10)
  if (!Number.isFinite(n) || n < size) return size
  // Always a whole number of pages.
  return Math.min(ADMIN_PAGE_MAX, Math.ceil(n / size) * size)
}

export type PageSlice<T> = { rows: T[]; shown: number; total: number; more: number; nextN: number | null }

/** The first `shown` rows of an already filtered list, with what is left. */
export function pageSlice<T>(all: readonly T[], shown: number, size = ADMIN_PAGE_SIZE): PageSlice<T> {
  const rows = all.slice(0, shown)
  const total = all.length
  const more = Math.max(0, total - rows.length)
  return { rows, shown: rows.length, total, more, nextN: more > 0 ? shown + size : null }
}

/** The same address with `n` set (or removed at the first page). Other
 *  parameters are kept in their order. */
export function withShown(path: string, params: Record<string, string | string[] | undefined>, n: number | null, size = ADMIN_PAGE_SIZE): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (k === 'n' || v === undefined) continue
    for (const one of Array.isArray(v) ? v : [v]) if (one !== '') q.append(k, one)
  }
  if (n && n > size) q.set('n', String(n))
  const s = q.toString()
  return s ? `${path}?${s}` : path
}

/** "Showing 25 of 312" / "All 12 shown". */
export function shownLine(slice: { shown: number; total: number }, noun = 'items'): string {
  if (slice.total === 0) return `No ${noun}`
  if (slice.shown >= slice.total) return `All ${slice.total} ${noun} shown`
  return `Showing ${slice.shown} of ${slice.total} ${noun}`
}

/** Plain-object copy of Next's searchParams, for withShown(). */
export function plainParams(sp: Record<string, string | string[] | undefined>): Record<string, string | string[] | undefined> {
  return { ...sp }
}
