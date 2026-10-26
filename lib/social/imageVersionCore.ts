// lib/social/imageVersionCore.ts — PURE, client-safe.
//
// Every social post, WhatsApp status image and profile link-preview image is
// drawn from the LIVE profile (owner, 26 Oct 2026). A drawn image may be reused
// (a browser cache, the edge cache, WhatsApp's own preview cache) only while a
// version key of everything it shows is unchanged:
//
//   the profile   name, photo version (the stored photo address), whether the
//                 photo is hidden, subjects, city, headline, verification;
//   the drawing   template, format, colour variant, crop settings.
//
// The key goes in the image URL (`k=` / `v=`), so any change is a new URL that
// browsers and WhatsApp fetch fresh. The image routes compute the key again
// from the live rows: a URL whose key no longer matches is still drawn live,
// but never cached. Old images are left to expire on their own.

export type ImageProfileFacts = {
  name: string
  /** The stored photo address — a new upload or crop is a new address. */
  photo: string | null
  photoHidden: boolean
  /** The tutor's subjects (master ids or labels — whatever the caller reads,
   *  as long as both sides read the same thing). Order does not matter. */
  subjects: (string | number)[]
  city: string | null
  headline: string | null
  verified: boolean
}

export type ImageDrawFacts = {
  template: string
  format: string
  variant?: number | null
  crop?: { zoom: number; x: number; y: number } | null
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

/** The key: a short FNV-1a hash of every fact the image shows. */
export function imageVersionKey(p: ImageProfileFacts, d: ImageDrawFacts): string {
  const crop = d.crop ?? { zoom: 1, x: 0, y: 0 }
  const facts = [
    clean(p.name),
    p.photoHidden ? 'hidden' : clean(p.photo),
    p.photoHidden,
    [...new Set(p.subjects.map((s) => String(s).trim().toLowerCase()).filter(Boolean))].sort(),
    clean(p.city).toLowerCase(),
    clean(p.headline),
    !!p.verified,
    d.template,
    d.format,
    d.variant ?? 0,
    [crop.zoom, crop.x, crop.y],
  ]
  const key = JSON.stringify(facts)
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/** Long cache only when the URL's key is the live one; otherwise draw live
 *  and keep nothing. `scope` = who may hold the cached copy. */
export function imageCacheControl(urlKey: string | null | undefined, liveKey: string, scope: 'public' | 'private'): string {
  if (urlKey && urlKey === liveKey) {
    return scope === 'public'
      ? 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'
      : 'private, max-age=31536000, immutable'
  }
  return 'private, no-store'
}

/** The profile link-preview image's drawing: Wide, "I'm a Verified Tutor" for a
 *  verified tutor, else the neutral "Tutor on TutorMint" look. */
export function ogDrawFacts(verified: boolean): ImageDrawFacts {
  return { template: verified ? 'verified' : 'profile', format: 'wide' }
}

/** The WhatsApp status image: the "I'm a Verified Tutor" design, Story size. */
export const STATUS_DRAW: ImageDrawFacts = { template: 'verified', format: 'story' }

/** A drawn image response with the cache header the key allows. */
export async function withImageCache(res: Response, cacheControl: string): Promise<Response> {
  const body = await res.arrayBuffer()
  return new Response(body, { status: res.status, headers: { 'Content-Type': 'image/png', 'Cache-Control': cacheControl } })
}
