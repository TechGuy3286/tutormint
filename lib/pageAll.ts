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

import { plainSupabaseError } from '@/lib/supabase/fetch'

export const PAGE_SIZE = 1000

type PageResult<T> = PromiseLike<{ data: T[] | null; error?: { message: string } | null }>

/** Fetch every row, 1,000 at a time, until a short page. */
export async function pageAll<T>(fetchPage: (from: number, to: number) => PageResult<T>, max = 200_000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < max; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(plainSupabaseError(error.message))
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
  /** Chunks read at the same time (PR-11: the Parent interest inbox reads
   *  thousands of ids — one chunk after another was most of its 10 s). The
   *  rows come back in the same order either way. */
  concurrency = 1,
): Promise<T[]> {
  const parts = chunk(ids, size)
  const results: T[][] = new Array(parts.length)
  let next = 0
  const worker = async () => {
    while (next < parts.length) {
      const i = next++
      results[i] = await pageAll((from, to) => fetchChunk(parts[i], from, to))
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, parts.length)) }, worker))
  return results.flat()
}

/** How many `.in()` chunks the admin read-models fetch at once (PR-11). */
export const READ_CONCURRENCY = 8
