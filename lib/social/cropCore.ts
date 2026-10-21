// lib/social/cropCore.ts
//
// Where to crop a tutor's photo for a social post — PURE.
//
// A post draws the photo large in a round frame, so the crop must sit on the
// face and shoulders: a full-length photo must never show a tiny person. There
// is no face-detection library in the stack, so the default is a smart crop
// that favours the upper centre of the picture — a tall photo is cropped
// tighter and from its top part, where a face almost always is.
//
// The admin's Zoom and Move controls adjust THIS POST only. They travel as
// query parameters on the render URL (zoom, x, y) and are never saved — not to
// the tutor's profile, not anywhere.

export type CropAdjust = {
  /** 1 = the default crop; up to 3 zooms in further. */
  zoom: number
  /** Steps of 10% of the crop's side: negative = left / up. Each -5..5. */
  x: number
  y: number
}

export const NO_ADJUST: CropAdjust = { zoom: 1, x: 0, y: 0 }
export const ZOOM_MIN = 1
export const ZOOM_MAX = 3
export const MOVE_STEPS = 5

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Read zoom / x / y from a URL's query; anything odd falls back to the default. */
export function parseCropAdjust(params: URLSearchParams): CropAdjust {
  const num = (k: string, d: number) => {
    const v = Number(params.get(k))
    return params.get(k) == null || !Number.isFinite(v) ? d : v
  }
  return {
    zoom: clamp(Math.round(num('zoom', 1) * 10) / 10, ZOOM_MIN, ZOOM_MAX),
    x: clamp(Math.round(num('x', 0)), -MOVE_STEPS, MOVE_STEPS),
    y: clamp(Math.round(num('y', 0)), -MOVE_STEPS, MOVE_STEPS),
  }
}

/** The query string for a non-default adjustment ('' when it is the default). */
export function cropQuery(a: CropAdjust): Record<string, string> {
  const out: Record<string, string> = {}
  if (a.zoom !== 1) out.zoom = String(a.zoom)
  if (a.x !== 0) out.x = String(a.x)
  if (a.y !== 0) out.y = String(a.y)
  return out
}

export type CropBox = { left: number; top: number; size: number }

/**
 * A square crop box inside a w × h picture.
 *  - Landscape or square: the full height, centred, nudged slightly up.
 *  - Portrait: the full width; a tall (full-length) photo is zoomed in so the
 *    head and shoulders fill the frame, taken from the upper part.
 * Then the admin's zoom and moves; the box always stays inside the picture.
 */
export function cropBox(w: number, h: number, adj: CropAdjust = NO_ADJUST): CropBox {
  const aspect = h / w
  const base = Math.min(w, h)
  // Tall pictures are usually full-length: zoom in on the top part.
  const autoZoom = aspect >= 1.6 ? 1.6 : aspect >= 1.25 ? 1.25 : 1
  const size = Math.max(1, Math.round(base / (autoZoom * clamp(adj.zoom, ZOOM_MIN, ZOOM_MAX))))
  let cx = w / 2
  // Portrait: the face sits in the top quarter or so; landscape: just above middle.
  let cy = aspect > 1 ? Math.min(h / 2, size / 2 + h * (aspect >= 1.6 ? 0.06 : 0.08)) : h * 0.46
  cx += adj.x * size * 0.1
  cy += adj.y * size * 0.1
  const left = Math.round(clamp(cx - size / 2, 0, w - size))
  const top = Math.round(clamp(cy - size / 2, 0, h - size))
  return { left, top, size }
}
