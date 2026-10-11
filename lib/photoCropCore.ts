// lib/photoCropCore.ts
//
// Profile-photo crop (owner, 11 Oct 2026) — the PURE half, shared by the crop
// frame (staff viewer and the member's upload step), the server that cuts the
// copy, the Avatar's default framing, and the tests. No DOM, no I/O.
//
// The crop frame is a square (shown round). The picture sits behind it at
// `scale` screen-pixels per image-pixel, with its top-left corner at (ox, oy)
// relative to the frame's top-left. The saved crop is three FRACTIONS of the
// picture, so it means the same thing at any size the picture is later read at:
//   x = left edge / width,  y = top edge / height,  s = side / width.

export type CropRect = { x: number; y: number; s: number }

/** Where a face usually is in a portrait photo: this far down from the top. */
export const FACE_TOP = 0.22

/** The Avatar's framing for a photo with no saved crop (item 1). */
export const AVATAR_OBJECT_POSITION = `50% ${Math.round(FACE_TOP * 100)}%`

/** Most a member or staff may zoom in. */
export const MAX_ZOOM = 4

/** The scale at which the picture just covers the frame (zoom 1). */
export function coverScale(w: number, h: number, frame: number): number {
  return frame / Math.min(w, h)
}

type View = { w: number; h: number; frame: number; scale: number; ox: number; oy: number }

/** Keep the frame fully covered: the picture can never show a gap. */
export function clampOffset(v: View): { ox: number; oy: number } {
  const minX = v.frame - v.w * v.scale
  const minY = v.frame - v.h * v.scale
  return { ox: Math.min(0, Math.max(minX, v.ox)), oy: Math.min(0, Math.max(minY, v.oy)) }
}

/** The starting position: centred left to right, face-first top to bottom. */
export function initialOffset(w: number, h: number, frame: number, scale: number): { ox: number; oy: number } {
  return clampOffset({ w, h, frame, scale, ox: -(w * scale - frame) / 2, oy: -(h * scale - frame) * FACE_TOP })
}

/** Zoom to `nextScale` keeping the point at the frame's centre where it is. */
export function zoomAtCentre(v: View, nextScale: number): { ox: number; oy: number } {
  const cx = (v.frame / 2 - v.ox) / v.scale
  const cy = (v.frame / 2 - v.oy) / v.scale
  return clampOffset({ ...v, scale: nextScale, ox: v.frame / 2 - cx * nextScale, oy: v.frame / 2 - cy * nextScale })
}

/** What the frame shows, as fractions of the picture. */
export function cropFromView(v: View): CropRect {
  const { ox, oy } = clampOffset(v)
  return { x: -ox / v.scale / v.w, y: -oy / v.scale / v.h, s: v.frame / v.scale / v.w }
}

export function validCrop(c: unknown): c is CropRect {
  if (!c || typeof c !== 'object') return false
  const { x, y, s } = c as Record<string, unknown>
  return [x, y, s].every((n) => typeof n === 'number' && Number.isFinite(n)) && (x as number) >= 0 && (y as number) >= 0 && (s as number) > 0.01 && (x as number) < 1 && (y as number) < 1
}

/** The crop in whole pixels of a w × h picture, always inside it and square. */
export function cropPixels(c: CropRect, w: number, h: number): { left: number; top: number; side: number } {
  const side = Math.max(1, Math.min(Math.round(c.s * w), w, h))
  const left = Math.max(0, Math.min(Math.round(c.x * w), w - side))
  const top = Math.max(0, Math.min(Math.round(c.y * h), h - side))
  return { left, top, side }
}

/** The saved copy's side: at least 512, at most 1024. */
export function outputSide(side: number): number {
  return Math.min(1024, Math.max(512, Math.round(side)))
}

/** The default crop for a picture nobody has framed: the Avatar's own framing. */
export function defaultCrop(w: number, h: number): CropRect {
  const scale = coverScale(w, h, 100)
  return cropFromView({ w, h, frame: 100, scale, ...initialOffset(w, h, 100, scale) })
}

// --- names of the copies -----------------------------------------------------

/** A staff crop: a NEW object next to the original, never over it. */
export function croppedCopyPath(originalPath: string, stamp: number): string {
  const dir = originalPath.includes('/') ? originalPath.slice(0, originalPath.lastIndexOf('/') + 1) : ''
  return `${dir}cropped-${stamp}.jpg`
}

/** A member upload: the photo as uploaded and the square they framed. */
export function memberPhotoPaths(userId: string, stamp: number): { original: string; crop: string } {
  return { original: `${userId}/photo-${stamp}-original.jpg`, crop: `${userId}/photo-${stamp}-crop.jpg` }
}

/** True for a square copy made by a crop (staff or member) — already framed. */
export function isCroppedAvatarUrl(url: string | null | undefined): boolean {
  return /\/cropped-\d+\.jpg(?:\?|$)|\/photo-\d+-crop\.jpg(?:\?|$)/.test(url ?? '')
}
