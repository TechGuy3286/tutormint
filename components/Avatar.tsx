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

import { avatarTint, initialsOf } from '@/lib/brand'

export { initialsOf }

export default function Avatar({
  name,
  src,
  seed,
  className = 'h-10 w-10 text-xs',
  ring = 'border-2 border-gray-100',
  decorative = false,
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
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={decorative ? '' : (name ?? '')}
        aria-hidden={decorative || undefined}
        className={`shrink-0 rounded-full bg-tm-bg object-cover ${ring} ${className}`}
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
