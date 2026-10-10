// lib/avatarRotationCore.ts
//
// Rotating a PROFILE PHOTO (owner, 10 Oct 2026) — the same rule as documents:
// a display rotation staff save, and the uploaded file is never changed.
//
// A profile photo is not served through a route of ours (it is a public
// storage URL that next/image, Google's crawler, WhatsApp's link preview, the
// social banner and the CV all fetch directly), so the rotation cannot be
// applied "on the way out" the way a document's is. Instead:
//   - the rotation is saved as a SETTING (avatar_rotations: rotation, the
//     uploaded original, the turned copy);
//   - a turned COPY of the picture is stored beside the original, and the
//     member's avatar_url points at the copy.
// The uploaded original is not modified, moved or removed, and rotation 0 puts
// avatar_url back to it. Because every surface reads avatar_url, the photo is
// the right way up everywhere at once — Browse cards, the profile, the header,
// messages, admin, og:image and structured data — with no per-screen work.
//
// When the member uploads a new photo, avatar_url changes; the saved row then
// no longer matches and counts as rotation 0 for the new picture.
//
// Pure: the plan below is everything the server does, decided without I/O.

import { normaliseRotation, rotateBy, type Rotation } from '@/lib/docRotation'

export type AvatarRotationRow = { rotation: number; original_url: string; rotated_url: string | null }

export type AvatarState = {
  /** The picture the member uploaded — what a rotation is always made from. */
  originalUrl: string
  /** The rotation currently shown. */
  rotation: Rotation
}

/** The current state: a saved row applies only while avatar_url is still its copy. */
export function currentAvatarState(avatarUrl: string, row: AvatarRotationRow | null | undefined): AvatarState {
  if (row && row.rotated_url && row.rotated_url === avatarUrl && normaliseRotation(row.rotation) !== 0) {
    return { originalUrl: row.original_url, rotation: normaliseRotation(row.rotation) }
  }
  return { originalUrl: avatarUrl, rotation: 0 }
}

export type AvatarPlan = {
  previous: Rotation
  rotation: Rotation
  originalUrl: string
  /** True when a turned copy must be made from the original; false at 0. */
  makeCopy: boolean
  /** What avatar_url becomes when no copy is needed (rotation 0): the original. */
  restoreUrl: string | null
}

/** Turn by `delta` quarter turns from what is shown now. */
export function planAvatarRotation(avatarUrl: string, row: AvatarRotationRow | null | undefined, delta: number): AvatarPlan {
  const state = currentAvatarState(avatarUrl, row)
  const rotation = rotateBy(state.rotation, delta)
  return {
    previous: state.rotation,
    rotation,
    originalUrl: state.originalUrl,
    makeCopy: rotation !== 0,
    restoreUrl: rotation === 0 ? state.originalUrl : null,
  }
}

/** Our PUBLIC storage buckets that hold profile photos. */
export const AVATAR_BUCKETS = ['avatars', 'tutor-media'] as const

/**
 * bucket + object path from one of OUR public storage URLs, or null. Anything
 * else — a data: URI, a signed URL, another host — is not ours to copy.
 */
export function parsePublicStorageUrl(url: string | null | undefined, supabaseOrigin: string): { bucket: string; path: string } | null {
  if (!url || !supabaseOrigin) return null
  const prefix = `${supabaseOrigin.replace(/\/$/, '')}/storage/v1/object/public/`
  // A host pinned in old data is normalised by the caller; compare on the path.
  const m = /^https:\/\/[a-z0-9]+\.supabase\.co(\/storage\/v1\/object\/public\/.+)$/i.exec(url)
  const full = m ? `${supabaseOrigin.replace(/\/$/, '')}${m[1]}` : url
  if (!full.startsWith(prefix)) return null
  const rest = decodeURIComponent(full.slice(prefix.length).split('?')[0])
  const slash = rest.indexOf('/')
  if (slash <= 0) return null
  const bucket = rest.slice(0, slash)
  const path = rest.slice(slash + 1)
  if (!(AVATAR_BUCKETS as readonly string[]).includes(bucket) || !path || path.includes('..')) return null
  return { bucket, path }
}

/** Where the turned copy goes: a NEW object next to the original, never over it. */
export function rotatedCopyPath(originalPath: string, rotation: Rotation, stamp: number): string {
  const dir = originalPath.includes('/') ? originalPath.slice(0, originalPath.lastIndexOf('/') + 1) : ''
  return `${dir}rotated-${stamp}-r${rotation}.jpg`
}
