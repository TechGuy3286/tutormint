// lib/defaultAvatar.ts
//
// Which default picture a member with NO usable photo gets.
//
// BRANDED DEFAULTS (owner, 5 Nov 2026). Male and female members get the
// owner's branded avatars (navy figure on a mint circle) from public/avatars/
// default-<gender>-<size>.webp, with a PNG fallback; sources are
// public/male-dummy.png and public/fe-male-dummy.png, resized by
// scripts/build-default-avatars.ts. Trans, an unset gender and any value we do
// not recognise keep the grey neutral silhouette (public/avatars/neutral.svg).
// "No usable photo" = never uploaded one, or chose "Hide my photo from parents"
// (public surfaces only — staff still see the real photo in admin).
//
// Pure and dependency-free on purpose: the component, the read-only report and
// the tests all read this one rule. A plain module (no 'use client'), so the
// server may import its values.

export type DefaultAvatarKind = 'male' | 'female' | 'neutral'

/** male → male, female → female, everything else (trans, null, unknown) → neutral. */
export function defaultAvatarKind(gender: string | null | undefined): DefaultAvatarKind {
  const g = (gender ?? '').trim().toLowerCase()
  if (g === 'male') return 'male'
  if (g === 'female') return 'female'
  return 'neutral'
}

/** The two sizes each branded default is cut at (px, square). */
export const DEFAULT_AVATAR_SIZES = [128, 512] as const

export type DefaultAvatarImage = {
  /** WebP srcset, "… 128w, … 512w". */
  webpSrcSet: string
  /** PNG srcset — the fallback for a browser without WebP. */
  pngSrcSet: string
  /** The PNG for a given drawn size (128 up to 64 px, else 512). */
  png: (px: number) => string
}

/** The branded default for male / female; null for the neutral silhouette. */
export function defaultAvatarImage(gender: string | null | undefined): DefaultAvatarImage | null {
  const kind = defaultAvatarKind(gender)
  if (kind === 'neutral') return null
  const f = (size: number, ext: 'webp' | 'png') => `/avatars/default-${kind}-${size}.${ext}`
  return {
    webpSrcSet: DEFAULT_AVATAR_SIZES.map((s) => `${f(s, 'webp')} ${s}w`).join(', '),
    pngSrcSet: DEFAULT_AVATAR_SIZES.map((s) => `${f(s, 'png')} ${s}w`).join(', '),
    png: (px: number) => f(px <= 64 ? 128 : 512, 'png'),
  }
}

/** One file for a gender (the 512 PNG, or the neutral SVG). Same-origin, so the
 *  CSP's img-src 'self' covers it. */
export function defaultAvatarSrc(gender: string | null | undefined): string {
  return defaultAvatarImage(gender)?.png(512) ?? '/avatars/neutral.svg'
}

export const DEFAULT_AVATAR_FILES = [
  ...(['male', 'female'] as const).flatMap((k) =>
    DEFAULT_AVATAR_SIZES.flatMap((s) => [`/avatars/default-${k}-${s}.webp`, `/avatars/default-${k}-${s}.png`]),
  ),
  '/avatars/neutral.svg',
] as const
