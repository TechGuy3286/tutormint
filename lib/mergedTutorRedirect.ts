// lib/mergedTutorRedirect.ts
//
// The 301 for the profile of a tutor account merged into another (owner,
// 26 Oct 2026): /tutor/<merged slug> → /tutor/<kept slug>. Called by proxy.ts
// (a page can only answer 308; the owner asked for a 301). Reads ONE thing —
// merged_tutor_redirects() (migration 201: the two slugs, nothing else) —
// through PostgREST with the publishable key, held in memory for a minute. Any
// failure answers null and the page renders as it would have.

const TTL_MS = 60_000
let cache: { at: number; bySlug: Map<string, string> } | null = null

async function merged(): Promise<Map<string, string> | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.bySlug
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!base || !key) return null
  try {
    const res = await fetch(`${base}/rest/v1/rpc/merged_tutor_redirects`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: '{}',
      cache: 'no-store',
    })
    if (!res.ok) return cache?.bySlug ?? null
    const rows = (await res.json()) as { slug: string | null; kept_slug: string | null }[]
    const bySlug = new Map<string, string>()
    for (const r of rows) if (r.slug && r.kept_slug) bySlug.set(r.slug.toLowerCase(), r.kept_slug)
    cache = { at: Date.now(), bySlug }
    return bySlug
  } catch {
    return cache?.bySlug ?? null
  }
}

const TUTOR_PATH = /^\/tutor\/([^/]+)\/?$/

/** "/tutor/<kept slug>" for a merged tutor's profile address, or null. */
export async function mergedTutorRedirectPath(pathname: string): Promise<string | null> {
  const m = TUTOR_PATH.exec(pathname)
  if (!m) return null
  const slug = decodeURIComponent(m[1]).toLowerCase()
  const map = await merged()
  const kept = map?.get(slug)
  return kept ? `/tutor/${kept}` : null
}
