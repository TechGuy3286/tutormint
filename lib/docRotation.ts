// lib/docRotation.ts
//
// A document's DISPLAY rotation (owner, 10 Oct 2026). Members upload CNICs and
// selfies sideways or upside down; staff turn the picture in the viewer and
// save it. The rotation is a setting on the document's row (user_documents
// .rotation, migration 160) — the stored original and preview are never
// modified, re-encoded or replaced. The preview route turns the picture as it
// serves it, so every screen that shows the document (staff and the member's
// own) gets the right way up with the right aspect, with no per-screen CSS.
//
// Pure and dependency-free: the route, the viewer and the tests read this.

export const ROTATIONS = [0, 90, 180, 270] as const
export type Rotation = (typeof ROTATIONS)[number]

/** Any number → 0 / 90 / 180 / 270 (clockwise). Junk is 0. */
export function normaliseRotation(v: unknown): Rotation {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n) || n % 90 !== 0) return 0
  return ((((n % 360) + 360) % 360) as Rotation)
}

/** True for exactly 0, 90, 180 or 270 — what the API accepts. */
export function isRotation(v: unknown): v is Rotation {
  return typeof v === 'number' && (ROTATIONS as readonly number[]).includes(v)
}

/** Turn by a quarter: +90 is "Rotate right ⟳", -90 is "Rotate left ⟲". */
export function rotateBy(current: number, delta: number): Rotation {
  return normaliseRotation(normaliseRotation(current) + normaliseRotation(delta))
}

/** A quarter turn swaps width and height. */
export function swapsAspect(rotation: number): boolean {
  const r = normaliseRotation(rotation)
  return r === 90 || r === 270
}

/** The browser event a saved rotation raises, so every thumbnail of that
 *  document on the page re-fetches its picture. */
export const DOC_ROTATED_EVENT = 'tm:doc-rotated'
