// lib/social/avatars.ts
//
// The three grey default silhouettes (public/avatars/*.svg) as data URIs, for the
// social render. satori embeds a data: URI directly, and public/ is not on the
// Vercel function filesystem, so the SVG text lives here. scripts/test-social-
// verified.ts fails if these drift from the files. Generated from public/avatars.
//
// PURE — the render, the routes and the tests read it.

import { defaultAvatarKind, type DefaultAvatarKind } from '@/lib/defaultAvatar'

export const SILHOUETTE_SVG: Record<DefaultAvatarKind, string> = {
  male: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 96 96\"><rect width=\"96\" height=\"96\" fill=\"#E5E7EB\"/><path d=\"M14 96c0-21 14-33 34-33s34 12 34 33z\" fill=\"#9CA3AF\"/><circle cx=\"48\" cy=\"38\" r=\"16\" fill=\"#9CA3AF\"/><path d=\"M32.5 36c-.5-10.5 6-15.5 15.5-15.5S64 25.5 63.5 36c-3-5-8-7.5-15.5-7.5S35.5 31 32.5 36z\" fill=\"#6B7280\"/></svg>",
  female: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 96 96\"><rect width=\"96\" height=\"96\" fill=\"#E5E7EB\"/><path d=\"M28 41C28 29 36.5 22 48 22C59.5 22 68 29 68 41L68 62Q68 66 63.5 66Q59 66 59 62L59 46L37 46L37 62Q37 66 32.5 66Q28 66 28 62Z\" fill=\"#6B7280\"/><path d=\"M14 96c0-21 14-33 34-33s34 12 34 33z\" fill=\"#9CA3AF\"/><circle cx=\"48\" cy=\"38\" r=\"16\" fill=\"#9CA3AF\"/><path d=\"M33 34C34 27 40 22.5 48 22.5C56 22.5 62 27 63 34C58 33.5 53.5 31 50.5 27C47 31 41 33.5 33 34Z\" fill=\"#6B7280\"/></svg>",
  neutral: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 96 96\"><rect width=\"96\" height=\"96\" fill=\"#E5E7EB\"/><circle cx=\"48\" cy=\"38\" r=\"16\" fill=\"#9CA3AF\"/><path d=\"M14 96c0-21 14-33 34-33s34 12 34 33z\" fill=\"#9CA3AF\"/></svg>",
}

/** The grey silhouette for a profile gender — female, male, else the neutral one. */
export function silhouetteDataUri(gender: string | null | undefined): string {
  const svg = SILHOUETTE_SVG[defaultAvatarKind(gender)]
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
}

/**
 * The picture a social post draws for a tutor: their photo, unless they turned
 * on "Hide my photo from parents" (or have none on file) — then the grey
 * silhouette for their gender. When hidden, the real URL is never returned, so
 * it cannot reach the PNG.
 */
export function socialPortraitSrc(avatarUrl: string | null | undefined, hidden: boolean, gender: string | null | undefined): string {
  if (hidden || !avatarUrl) return silhouetteDataUri(gender)
  return avatarUrl
}
