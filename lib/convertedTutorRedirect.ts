// lib/convertedTutorRedirect.ts
//
// The 301 for a tutor profile hidden because the account was changed to a
// parent account (owner, 23 Oct 2026; Convert account type): /tutor/<slug> →
// /browse/tutors?city=<their city>. Called by proxy.ts, because a page can
// only answer 308 and the owner asked for a 301.
//
// It reads ONE thing — converted_tutor_redirects() (migration 196: the slug
// and city of hidden, converted profiles, nothing else) — through PostgREST
// with the publishable key, and keeps the answer in memory for one minute, so
// a profile request costs no query most of the time. Any failure answers null:
// the page renders as it would have (it also redirects such a profile itself,
// with Next's 308, as a backstop).

import { convertedTutorRedirect } from '@/lib/convertAccountCore'

import { makeBackoff, proxyFetch } from '@/lib/proxyLookup'

const TTL_MS = 60_000
const backoff = makeBackoff()
let cache: { at: number; bySlug: Map<string, string | null> } | null = null

async function converted(): Promise<Map<string, string | null> | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.bySlug
  if (backoff.waiting()) return cache?.bySlug ?? null
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!base || !key) return null
  try {
    const res = await proxyFetch(`${base}/rest/v1/rpc/converted_tutor_redirects`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: '{}',
      cache: 'no-store',
    })
    if (!res.ok) {
      backoff.failed()
      return cache?.bySlug ?? null
    }
    const rows = (await res.json()) as { slug: string | null; city: string | null }[]
    const bySlug = new Map<string, string | null>()
    for (const r of rows) if (r.slug) bySlug.set(r.slug.toLowerCase(), r.city ?? null)
    cache = { at: Date.now(), bySlug }
    return bySlug
  } catch {
    backoff.failed()
    return cache?.bySlug ?? null
  }
}

const TUTOR_PATH = /^\/tutor\/([^/]+)\/?$/

/** Where a hidden (converted) tutor profile's address goes, or null. */
export async function convertedTutorRedirectPath(pathname: string): Promise<string | null> {
  const m = TUTOR_PATH.exec(pathname)
  if (!m) return null
  const slug = decodeURIComponent(m[1]).toLowerCase()
  // The member area under /tutor/* is never a profile address.
  if (['dashboard', 'onboarding', 'complete-profile', 'packages', 'claim', 'register', 'login', 'verify', 'upload-youtube'].includes(slug)) return null
  const map = await converted()
  if (!map || !map.has(slug)) return null
  return convertedTutorRedirect(map.get(slug) ?? null)
}
