// One avatar, everywhere.
//
// The fallback is initials on a brand tint -- never a grey disc and never a
// stock face. A placeholder photograph on a real person's profile is a small
// lie about them, and a plain grey circle in a list of ten looks like ten
// broken images rather than ten people who have not uploaded one yet.
//
// The tint is picked deterministically from the seed, so the same person keeps
// the same colour on every screen and across reloads. It carries no meaning --
// it is not a role, a plan or a status -- it exists so a list of avatars is
// scannable. All four pairs are AA-checked in scripts/contrast-check.ts.
//
// This replaced, among others, an api.dicebear.com URL in the admin tutor
// queue: it sent every tutor's real name to a third party as a query string,
// and img-src in the CSP does not name that host, so in production it rendered
// nothing at all.
//
// No 'use client' directive: it holds no state, so it renders on the server and
// is equally importable from a client component.
//
// RESIZED, MODERN FORMAT, LONG-CACHED (owner, 6 Oct 2026). A photo stored in a
// Supabase PUBLIC bucket goes through next/image: served at the size it is
// drawn (and 2x for retina), as AVIF/WebP, from Vercel's image cache with a
// 31-day max-age (next.config.ts `images`). Browse tutors was downloading 1.5 MB
// of full-resolution JPEGs for twelve 72-px discs. Anything else -- a data: URI,
// a signed URL, a foreign host -- keeps the plain <img>, because only the public
// object path is allowed through the optimiser and the rest must never be.

import Image from 'next/image'

import { avatarTint, initialsOf } from '@/lib/brand'

export { initialsOf }

// Defensive host normalisation. Some avatar_url values are stored as ABSOLUTE
// URLs (the seed script did this), which pins a Supabase project HOST into the
// data. When the project moves — as it did Sydney -> Mumbai — that stale host no
// longer matches the CSP `img-src` (derived from NEXT_PUBLIC_SUPABASE_URL at
// build), so the browser BLOCKS the image and it renders broken. Rewriting any
// Supabase-storage origin to the CURRENT host at render time means a host change
// can never break an avatar again: storage is copied path-for-path, so the file
// is at the same path on the new project. data:/blob:/foreign URLs pass through
// untouched.
const CURRENT_SUPABASE_ORIGIN = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin
  } catch {
    return ''
  }
})()

export function normalizeStorageSrc(src: string): string {
  if (!CURRENT_SUPABASE_ORIGIN) return src
  const m = src.match(/^https:\/\/[a-z0-9]+\.supabase\.co(\/storage\/.*)$/i)
  return m ? CURRENT_SUPABASE_ORIGIN + m[1] : src
}

/**
 * True when next/image may optimise this source: an object in one of OUR public
 * storage buckets on the current project host. Matches next.config.ts
 * remotePatterns exactly, so a URL that would make next/image throw ("hostname
 * not configured") never reaches it.
 */
export function isOptimisableStorageSrc(src: string): boolean {
  if (!CURRENT_SUPABASE_ORIGIN) return false
  return src.startsWith(`${CURRENT_SUPABASE_ORIGIN}/storage/v1/object/public/`)
}

export default function Avatar({
  name,
  src,
  seed,
  className = 'h-10 w-10 text-xs',
  ring = 'border-2 border-gray-100',
  decorative = false,
  px = 48,
  sizes,
  priority = false,
}: {
  name: string | null | undefined
  src?: string | null
  /** Prefer a stable id; the name is the fallback so a rename is the only thing that recolours. */
  seed?: string | null
  /** Sizing and font size. Tailwind needs whole class names, so callers pass complete ones. */
  className?: string
  ring?: string
  /**
   * True when the name is already written next to the avatar, which it usually
   * is on a card. A second announcement of the same name is noise to a screen
   * reader, not information.
   */
  decorative?: boolean
  /**
   * The LARGEST size the avatar is drawn at, in CSS pixels (the sm: breakpoint
   * value when it grows). Decides the resized widths next/image offers; the
   * browser picks 1x or 2x from `sizes`. Default 48 (a 40–48 px list disc).
   */
  px?: number
  /** A `sizes` attribute when the drawn size changes with the viewport, e.g.
   *  "(min-width: 640px) 140px, 72px". Defaults to `${px}px`. */
  sizes?: string
  /** True for the first visible photo on a page (fetchpriority=high + preload). */
  priority?: boolean
}) {
  if (src) {
    const resolved = normalizeStorageSrc(src)
    const alt = decorative ? '' : (name ?? '')
    const cls = `shrink-0 rounded-full bg-tm-bg object-cover ${ring} ${className}`
    if (isOptimisableStorageSrc(resolved)) {
      return (
        <Image
          src={resolved}
          alt={alt}
          aria-hidden={decorative || undefined}
          width={px}
          height={px}
          sizes={sizes ?? `${px}px`}
          priority={priority}
          className={cls}
        />
      )
    }
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a data: URI, a
      // signed URL or a foreign host: not ours to optimise, see above.
      <img
        src={resolved}
        alt={alt}
        aria-hidden={decorative || undefined}
        width={px}
        height={px}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        className={cls}
      />
    )
  }

  return (
    <span
      aria-hidden={decorative || undefined}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : (name ?? undefined)}
      className={`flex shrink-0 items-center justify-center rounded-full font-black ${ring} ${avatarTint(seed || name || '?').className} ${className}`}
    >
      {initialsOf(name)}
    </span>
  )
}
