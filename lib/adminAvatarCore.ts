// lib/adminAvatarCore.ts — PURE (owner, 18 Nov 2026 — PR-04).
//
// Admin shows every member's picture the way the public pages do when there
// is none: the branded male / female default, or the grey neutral silhouette
// for a missing gender or Trans (lib/defaultAvatar is the one rule). A small
// "No photo" tag says it is not an uploaded photo. A REAL photo — even one the
// tutor hides from parents — is still shown to staff as it is. Display only:
// nothing here touches verification, stages or completion.

import { defaultAvatarKind, type DefaultAvatarKind } from './defaultAvatar'

export const NO_PHOTO_TAG = 'No photo'

export type AdminAvatarFacts = { src: string | null; gender: string | null }

export type AdminAvatarView = {
  /** The uploaded photo to draw, or null → the default picture. */
  src: string | null
  gender: string | null
  /** No uploaded photo: draw the default and the "No photo" tag. */
  noPhoto: boolean
  /** Which default picture, when noPhoto. */
  kind: DefaultAvatarKind
}

/** Staff see the real photo whatever the public setting; only a missing photo gets the default. */
export function adminAvatarView(f: Partial<AdminAvatarFacts> | null | undefined): AdminAvatarView {
  const src = (f?.src ?? '').trim() || null
  const gender = f?.gender ?? null
  return { src, gender, noPhoto: !src, kind: defaultAvatarKind(gender) }
}

/** The photo a member's admin picture uses: the tutor profile's, else the profile's. */
export function pickAvatarSrc(tutorAvatar: string | null | undefined, profileAvatar: string | null | undefined): string | null {
  return (tutorAvatar ?? '').trim() || (profileAvatar ?? '').trim() || null
}
