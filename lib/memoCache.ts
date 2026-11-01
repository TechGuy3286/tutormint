import 'server-only'

// In-memory cache for shared read-only data (push 3, owner 1 Nov 2026).
//
// Replaces every unstable_cache() in the app. unstable_cache is Vercel's Data
// Cache, which Vercel starts billing as Runtime Cache on 29 Jan 2027: every
// call is a paid read and every refill a paid write. The public pages that
// used these caches are now cached whole (ISR), so the data cache under them
// bought little. This keeps the same idea — one answer shared for a while —
// in the server's own memory, which Vercel does not bill: an instance keeps
// the answer for `revalidate` seconds (capped by `maxSeconds` where the caller
// wants fresher data), and invalidateMemoTag() drops it at once on the
// instance that made a change. Other instances catch up within the time
// limit. Same signature as unstable_cache, so callers did not change shape.
//
// It counts its own use (calls, hits, refills per cache key) in memory only.
// It never writes the counts anywhere: a cached page may be built while this
// runs, and nothing during a cached page build may write to the database
// (hotfix, 1 Nov 2026 — the old 5-minute save of these counts did, and turned
// first renders into 500s).

type Entry = { at: number; value: Promise<unknown> }
type Opts = { revalidate?: number | false; tags?: string[] }

const entries = new Map<string, Entry>()
const tagIndex = new Map<string, Set<string>>()

type Tally = { calls: number; hits: number; refills: number }
const tally = new Map<string, Tally>()

export function memoize<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  keyParts: string[] = [],
  opts: Opts = {},
): (...args: A) => Promise<R> {
  const base = keyParts.join('|') || fn.name || 'memo'
  const ttlMs = opts.revalidate === false ? Infinity : Math.max(1, opts.revalidate ?? 300) * 1000
  return (...args: A) => {
    const key = `${base}:${JSON.stringify(args)}`
    const t = tally.get(base) ?? { calls: 0, hits: 0, refills: 0 }
    tally.set(base, t)
    t.calls += 1
    const now = Date.now()
    const hit = entries.get(key)
    let out: Promise<R>
    if (hit && now - hit.at < ttlMs) {
      t.hits += 1
      out = hit.value as Promise<R>
    } else {
      t.refills += 1
      out = fn(...args)
      entries.set(key, { at: now, value: out })
      for (const tag of opts.tags ?? []) {
        const set = tagIndex.get(tag) ?? new Set<string>()
        set.add(key)
        tagIndex.set(tag, set)
      }
      // A failed load is never kept.
      out.catch(() => {
        if (entries.get(key)?.value === out) entries.delete(key)
      })
    }
    return out
  }
}

/** Drop every cached answer carrying this tag (on this server instance). */
export function invalidateMemoTag(tag: string): void {
  const keys = tagIndex.get(tag)
  if (!keys) return
  for (const k of keys) entries.delete(k)
  tagIndex.delete(tag)
}

/** For tests. */
export function memoTallyForTests(): Map<string, Tally> {
  return tally
}
