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
