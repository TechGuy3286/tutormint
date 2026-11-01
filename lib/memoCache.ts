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
// It counts its own use (calls, hits, refills per cache key) and adds the
// counts to admin_summary 'cachestats' every few minutes, so the report can
// say how many Runtime Cache reads and writes these calls would have been.

type Entry = { at: number; value: Promise<unknown> }
type Opts = { revalidate?: number | false; tags?: string[] }

const entries = new Map<string, Entry>()
const tagIndex = new Map<string, Set<string>>()

type Tally = { calls: number; hits: number; refills: number }
const tally = new Map<string, Tally>()
let lastFlush = Date.now()
const FLUSH_EVERY_MS = 5 * 60_000

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
    maybeFlush(now)
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

function maybeFlush(now: number): void {
  if (now - lastFlush < FLUSH_EVERY_MS || tally.size === 0) return
  lastFlush = now
  const delta = [...tally.entries()].map(([k, v]) => [k, { ...v }] as const)
  tally.clear()
  void flush(delta).catch(() => {})
}

type Stats = Record<string, Record<string, Tally>>

async function flush(delta: (readonly [string, Tally])[]): Promise<void> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const admin = createAdminClient()
  if (!admin) return
  const day = new Date().toISOString().slice(0, 10)
  const { data } = await admin.from('admin_summary').select('payload').eq('key', 'cachestats').maybeSingle()
  const stats = ((data?.payload as Stats | null) ?? {}) as Stats
  const today = stats[day] ?? {}
  for (const [k, v] of delta) {
    const t = today[k] ?? { calls: 0, hits: 0, refills: 0 }
    today[k] = { calls: t.calls + v.calls, hits: t.hits + v.hits, refills: t.refills + v.refills }
  }
  stats[day] = today
  // Keep two weeks.
  for (const d of Object.keys(stats).sort().slice(0, -14)) delete stats[d]
  await admin.from('admin_summary').upsert({ key: 'cachestats', payload: stats, computed_at: new Date().toISOString() })
}
