// The id rules every infinite list follows (owner, 10 Oct 2026).
//
// "Sehar Arif" showed twice on /browse/tutors: one fresh card in the
// server-rendered first window and one older copy (no tagline yet) from rows a
// browser had saved in sessionStorage on an earlier "Show more". Her documents
// were approved and her profile saved in between, so she moved UP into the first
// window — and lib/useInfinite restored the saved rows under it without looking
// at ids. These two pure functions are what the hook now does instead.

/** A row's id, when it has a string one. Rows without an id are never deduped. */
export function rowId(row: unknown): string | null {
  const id = (row as { id?: unknown } | null)?.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

/**
 * Append `next` to `prev`, dropping any row whose id is already shown — in
 * `prev`, in the server window (`exclude`), or earlier in `next` itself.
 */
export function mergeUnique<T>(prev: T[], next: T[], exclude: Iterable<string> = []): T[] {
  const seen = new Set<string>(exclude)
  for (const r of prev) {
    const id = rowId(r)
    if (id) seen.add(id)
  }
  const out = [...prev]
  for (const r of next) {
    const id = rowId(r)
    if (id) {
      if (seen.has(id)) continue
      seen.add(id)
    }
    out.push(r)
  }
  return out
}

/**
 * Whether a saved snapshot may be restored under a fresh server window. If any
 * saved row is now ALSO in the server window, the ranking has moved since it
 * was saved — the snapshot (its rows AND its cursor) is stale, so it is
 * discarded and the list continues from the server's own cursor.
 */
export function snapshotUsable(saved: unknown[], serverIds: Iterable<string>): boolean {
  const server = new Set(serverIds)
  if (server.size === 0) return true
  return !saved.some((r) => {
    const id = rowId(r)
    return id !== null && server.has(id)
  })
}

/** Render guard: the first occurrence of each id, rows without an id kept. */
export function uniqueById<T>(rows: T[]): T[] {
  return mergeUnique([], rows)
}
