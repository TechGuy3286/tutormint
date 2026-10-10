// One avatar, everywhere.
//
// NO PHOTO -> A GREY, GENDER-BASED DEFAULT (owner, 10 Oct 2026). A member
// without a picture gets one of three static greyscale silhouettes from
// public/avatars/ -- male, female, or neutral (Trans, gender not set, or a
// value we do not recognise). lib/defaultAvatar.ts is the one rule. This
// replaced the coloured initials disc for members on every surface. It is drawn
// with the same size, round shape and ring as the photo, so layouts do not move.
// The default is NEVER an og:image or structured-data image -- those read
// avatar_url themselves and fall back to the site default.
//
// History worth keeping: an earlier fallback was an api.dicebear.com URL in the
// admin tutor queue. It sent every tutor's real name to a third party as a
// query string, and img-src in the CSP does not name that host, so in
// production it rendered nothing at all. The defaults are same-origin files.
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

import { defaultAvatarSrc } from '@/lib/defaultAvatar'

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

// Bumped whenever a drawing in public/avatars/ changes, so browsers and the CDN
// fetch the new file at once instead of a cached old one. v2 (10 Oct 2026): plain
// male and female silhouettes, no headscarf.
const DEFAULT_AVATAR_VERSION = 2

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
  gender,
  className = 'h-10 w-10 text-xs',
  ring = 'border-2 border-gray-100',
  decorative = false,
  px = 48,
  sizes,
  priority = false,
}: {
  name: string | null | undefined
  src?: string | null
  /**
   * The member's gender (tutor_profiles.gender). Only read when there is no
   * photo: it picks the male / female / neutral default. Parents have no gender
   * on record, so callers leave it out and get the neutral one.
   */
  gender?: string | null
  /** Sizing. Tailwind needs whole class names, so callers pass complete ones. */
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
    // eslint-disable-next-line @next/next/no-img-element -- a static SVG under
    // 2 KB in public/: nothing for the optimiser to do, and next/image refuses SVG.
    <img
      src={`${defaultAvatarSrc(gender)}?v=${DEFAULT_AVATAR_VERSION}`}
      alt={decorative ? '' : (name ?? '')}
      aria-hidden={decorative || undefined}
      data-default-avatar=""
      width={px}
      height={px}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      className={`shrink-0 rounded-full bg-tm-bg object-cover ${ring} ${className}`}
    />
  )
}
