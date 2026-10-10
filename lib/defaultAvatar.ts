// lib/defaultAvatar.ts
//
// Which default picture a member with NO photo gets (owner, 10 Oct 2026).
//
// Three greyscale silhouettes in public/avatars/: male, female, neutral. The
// member's gender picks one; Trans, an unset gender and any value we do not
// recognise all get the neutral one. This replaced the coloured initials disc
// for members everywhere the shared <Avatar> is drawn.
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

/** The static file for a gender. Same-origin, so the CSP's img-src 'self' covers it. */
export function defaultAvatarSrc(gender: string | null | undefined): string {
  return `/avatars/${defaultAvatarKind(gender)}.svg`
}

export const DEFAULT_AVATAR_FILES = ['/avatars/male.svg', '/avatars/female.svg', '/avatars/neutral.svg'] as const
