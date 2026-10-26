// lib/erasedTutorRedirect.ts
//
// The 301 for the profile of a tutor whose data was erased on request (owner,
// 27 Oct 2026): /tutor/<old slug> → /browse/tutors?city=<their city>. Called by
// proxy.ts. The old address carried the tutor's name, so it is not kept:
// erased_tutor_redirects() (migration 203) returns only a sha256 of each old
// address and the city; the requested slug is hashed here and compared. Held in
// memory for a minute; any failure answers null (the page is then a 404).

import { erasedTutorTarget, normaliseSlug } from '@/lib/accountEraseCore'
import { makeBackoff, proxyFetch } from '@/lib/proxyLookup'

const TTL_MS = 60_000
const backoff = makeBackoff()
let cache: { at: number; byHash: Map<string, string | null> } | null = null

async function erased(): Promise<Map<string, string | null> | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.byHash
  if (backoff.waiting()) return cache?.byHash ?? null
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!base || !key) return null
  try {
    const res = await proxyFetch(`${base}/rest/v1/rpc/erased_tutor_redirects`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: '{}',
      cache: 'no-store',
    })
    if (!res.ok) {
      backoff.failed()
      return cache?.byHash ?? null
    }
    const rows = (await res.json()) as { slug_hash: string | null; city: string | null }[]
    const byHash = new Map<string, string | null>()
    for (const r of rows) if (r.slug_hash) byHash.set(r.slug_hash, r.city ?? null)
    cache = { at: Date.now(), byHash }
    return byHash
  } catch {
    backoff.failed()
    return cache?.byHash ?? null
  }
}

/** sha256 hex of the normalised slug (Web Crypto — works in the proxy). */
export async function sha256Slug(slug: string): Promise<string> {
  const bytes = new TextEncoder().encode(normaliseSlug(slug))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const TUTOR_PATH = /^\/tutor\/([^/]+)\/?$/

/** Where an erased tutor's old profile address goes, or null. */
export async function erasedTutorRedirectPath(pathname: string): Promise<string | null> {
  const m = TUTOR_PATH.exec(pathname)
  if (!m) return null
  const map = await erased()
  if (!map || map.size === 0) return null
  let hash: string
  try {
    hash = await sha256Slug(m[1])
  } catch {
    return null
  }
  if (!map.has(hash)) return null
  return erasedTutorTarget(map.get(hash) ?? null)
}
