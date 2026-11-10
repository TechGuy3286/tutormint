// lib/photoBlankCore.ts
//
// PURE. "Photo looks blank" (owner, 9 Nov 2026): a profile photo or selfie
// that is almost entirely black, or almost one flat colour (a white, grey or
// covered-lens frame), is FLAGGED for staff. Nothing is ever rejected by this —
// staff decide, with the existing rejection flow ("Reject — photo unclear").
//
// The picture is shrunk to BLANK_SIZE × BLANK_SIZE greyscale (lib/photoBlank,
// sharp) and read here:
//   dark share  the share of pixels darker than DARK_LEVEL
//   spread      the standard deviation of the brightness
// Blank = dark share ≥ DARK_SHARE_MIN (almost all black) OR spread < SPREAD_MIN
// (almost no detail at all). An ordinary face photo has a spread well above
// 25 and only a small dark share, even in poor light.
//
// Unit-tested by scripts/test-people-cleanup.ts.

export const BLANK_SIZE = 64
export const DARK_LEVEL = 28
export const DARK_SHARE_MIN = 0.95
export const SPREAD_MIN = 6

export type BlankStats = { darkShare: number; spread: number; mean: number }

/** The brightness figures of a greyscale pixel buffer (one byte a pixel). */
export function greyStats(grey: Uint8Array): BlankStats {
  const n = grey.length
  if (n === 0) return { darkShare: 1, spread: 0, mean: 0 }
  let sum = 0
  let dark = 0
  for (let i = 0; i < n; i++) {
    sum += grey[i]
    if (grey[i] < DARK_LEVEL) dark++
  }
  const mean = sum / n
  let sq = 0
  for (let i = 0; i < n; i++) sq += (grey[i] - mean) ** 2
  return { darkShare: dark / n, spread: Math.sqrt(sq / n), mean }
}

export function looksBlank(s: BlankStats): boolean {
  return s.darkShare >= DARK_SHARE_MIN || s.spread < SPREAD_MIN
}

/** The two photos the check covers. */
export type BlankItem = 'photo' | 'selfie'

/**
 * Which of a member's CURRENT photos are flagged. A check is stored per file
 * (the photo address, or the selfie document id), so a new upload is checked
 * afresh and an old flag never sticks to a new photo.
 */
export function currentBlankItems(
  current: { photoRefs: (string | null | undefined)[]; selfieRefs: (string | null | undefined)[] },
  blankRefs: { photo: Set<string>; selfie: Set<string> },
): BlankItem[] {
  const out: BlankItem[] = []
  if (current.photoRefs.some((r) => !!r && blankRefs.photo.has(r))) out.push('photo')
  if (current.selfieRefs.some((r) => !!r && blankRefs.selfie.has(r))) out.push('selfie')
  return out
}

/** The one-tap button on a flagged photo. */
export const BLANK_REJECT_LABEL = 'Reject — photo unclear'

/** The reason it sends — the EXISTING quick reason for that item
 *  (lib/rejectReasonsCore REJECT_REASONS), so the member gets the same in-app
 *  notice, email and WhatsApp wording as any other rejection. */
export function blankRejectReason(item: BlankItem): string {
  return item === 'selfie' ? 'Selfie not clear — retake in good light' : 'Profile photo must show your face clearly'
}

// ---------------------------------------- in the browser (owner, 10 Nov 2026) --
//
// The selfie camera and the profile-photo step check the picture BEFORE it is
// sent, with the SAME size and thresholds as the server check above, so a photo
// the browser lets through is not flagged later for being dark, and the other
// way round. The server flag stays as the backstop.

/** Shown when the picture is almost entirely dark or blank. */
export const PHOTO_TOO_DARK = 'Photo is too dark. Please retake it in good light.'

/** Greyscale (one byte a pixel) from RGBA canvas pixels — the sRGB luma weights. */
export function rgbaToGrey(rgba: ArrayLike<number>): Uint8Array {
  const n = Math.floor(rgba.length / 4)
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4]
    const g = rgba[i * 4 + 1]
    const b = rgba[i * 4 + 2]
    out[i] = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)
  }
  return out
}

/** True when BLANK_SIZE × BLANK_SIZE RGBA pixels look blank (the server rule). */
export function pixelsLookBlank(rgba: ArrayLike<number>): boolean {
  return looksBlank(greyStats(rgbaToGrey(rgba)))
}

/** The selfie camera waits this long after the first frame before "Take photo"
 *  turns on — and only once a frame is not blank. */
export const CAMERA_WARMUP_MS = 1000

// ---------------------------------------------- "Looks fine" (owner, 10 Nov 2026) --
//
// Staff may clear the flag of a checked file. A cleared row stays (who and
// when), Undo empties the stamps, and a file is checked once only — so a file
// staff called fine is never flagged again.

export const LOOKS_FINE_LABEL = 'Looks fine'

export type BlankCheckRow = { item: BlankItem; ref: string; blank: boolean; cleared_at?: string | null }

/** The files still flagged: blank, and not cleared by staff. */
export function flaggedRefs(rows: BlankCheckRow[]): { photo: Set<string>; selfie: Set<string> } {
  const out = { photo: new Set<string>(), selfie: new Set<string>() }
  for (const r of rows) {
    if (!r.blank || r.cleared_at) continue
    out[r.item].add(r.ref)
  }
  return out
}

/** A file is checked once: an existing row (cleared or not) is never rewritten. */
export function needsCheck(alreadyChecked: Set<string>, item: BlankItem, ref: string): boolean {
  return !alreadyChecked.has(`${item}:${ref}`)
}
