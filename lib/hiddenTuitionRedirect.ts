// lib/hiddenTuitionRedirect.ts
//
// The 301 for a tuition hidden because its parent account was hidden, marked
// test, suspended or banned (owner, 24 Oct 2026): /tuitions/<city>/<slug> →
// the city's public tuition page. Called by proxy.ts, because a page can only
// answer 308 and the owner asked for a 301.
//
// It reads ONE thing — hidden_tuition_redirects() (migration 198: slug, city,
// whether the city still has an open tuition) — through PostgREST with the
// publishable key, held in memory for one minute. Any failure answers null:
// the page then redirects itself with Next's 308, as a backstop.

import { hiddenTuitionTarget, tuitionSlugOf } from '@/lib/hiddenTuitionCore'

import { makeBackoff, proxyFetch } from '@/lib/proxyLookup'

const TTL_MS = 60_000
const backoff = makeBackoff()
let cache: { at: number; bySlug: Map<string, string> } | null = null

async function hidden(): Promise<Map<string, string> | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.bySlug
  if (backoff.waiting()) return cache?.bySlug ?? null
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!base || !key) return null
  try {
    const res = await proxyFetch(`${base}/rest/v1/rpc/hidden_tuition_redirects`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: '{}',
      cache: 'no-store',
    })
    if (!res.ok) {
      backoff.failed()
      return cache?.bySlug ?? null
    }
    const rows = (await res.json()) as { slug: string | null; city: string | null; city_has_open: boolean | null }[]
    const bySlug = new Map<string, string>()
    for (const r of rows) if (r.slug) bySlug.set(r.slug.toLowerCase(), hiddenTuitionTarget(r.city, !!r.city_has_open))
    cache = { at: Date.now(), bySlug }
    return bySlug
  } catch {
    backoff.failed()
    return cache?.bySlug ?? null
  }
}

/** Where a hidden tuition's address goes, or null. */
export async function hiddenTuitionRedirectPath(pathname: string): Promise<string | null> {
  const slug = tuitionSlugOf(pathname)
  if (!slug) return null
  const map = await hidden()
  return map?.get(slug) ?? null
}
