// lib/pageAll.ts
//
// THE 1,000-ROW CAP (owner, 8 Oct 2026). PostgREST returns at most `max-rows`
// (1,000) rows per request, silently — `.limit()` above 1,000 is still 1,000, and a
// plain `.select()` of a bigger table just stops. Every read that is meant to be
// a WHOLE list (a count by `.length`, a distinct set, a map keyed by id, a
// sitemap, an export) goes through one of these helpers instead.
//
// The caller supplies a page fetcher that applies `.range(from, to)` to a query
// with a STABLE order, so pages do not overlap or skip.

export const PAGE_SIZE = 1000

type PageResult<T> = PromiseLike<{ data: T[] | null; error?: { message: string } | null }>

/** Fetch every row, 1,000 at a time, until a short page. */
export async function pageAll<T>(fetchPage: (from: number, to: number) => PageResult<T>, max = 200_000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < max; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE_SIZE) break
  }
  return out
}

/** Split a list into chunks (for `.in()` filters, which also make long URLs). */
export function chunk<T>(list: T[], size = 100): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/**
 * `.in(column, ids)` for a list of ANY length, each chunk paged — the pattern
 * for "every job_subjects row for these 600 jobs". `fetchChunk` builds the
 * query for one chunk and applies the range.
 */
export async function pageAllIn<T, K>(
  ids: K[],
  fetchChunk: (ids: K[], from: number, to: number) => PageResult<T>,
  size = 100,
): Promise<T[]> {
  const out: T[] = []
  for (const part of chunk(ids, size)) {
    out.push(...(await pageAll((from, to) => fetchChunk(part, from, to))))
  }
  return out
}
