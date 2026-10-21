// lib/photoHashCore.ts
//
// Is a selfie the same picture as the profile photo? (owner, 21 Oct 2026) — the
// PURE half. A 64-bit difference hash (dHash): the image shrunk to 9 × 8 grey
// pixels; each bit says whether a pixel is brighter than the one to its right.
// Re-saving, resizing or recompressing a picture barely changes it; a different
// photo of the same face changes many bits. Two pictures "look the same" when
// at most MATCH_BITS of the 64 bits differ, or when the files are byte-identical.
//
// It is only a WARNING to staff — the Owner still decides.

export const HASH_W = 9
export const HASH_H = 8
/** At most this many of the 64 bits may differ for two images to look the same. */
export const MATCH_BITS = 10

export const SELFIE_MATCH_WARNING = 'Looks the same as the profile picture — check it’s a live selfie.'

/** dHash of a 9 × 8 greyscale buffer (row by row, one byte a pixel) → 16 hex digits. */
export function dhashFromGrey(px: Uint8Array | number[]): string {
  if (px.length < HASH_W * HASH_H) throw new Error('need 72 grey pixels')
  let hex = ''
  let nibble = 0
  let bits = 0
  for (let y = 0; y < HASH_H; y++) {
    for (let x = 0; x < HASH_W - 1; x++) {
      const bit = px[y * HASH_W + x] > px[y * HASH_W + x + 1] ? 1 : 0
      nibble = (nibble << 1) | bit
      if (++bits === 4) {
        hex += nibble.toString(16)
        nibble = 0
        bits = 0
      }
    }
  }
  return hex
}

/** How many bits differ between two hashes (64 when either is unreadable). */
export function hammingHex(a: string, b: string): number {
  if (!/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b)) return 64
  let d = 0
  for (let i = 0; i < 16; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) {
      d += x & 1
      x >>= 1
    }
  }
  return d
}

export function hashesLookSame(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return hammingHex(a, b) <= MATCH_BITS
}

/** The decision: same file (equal SHA-256), or a near-identical image. */
export function selfieMatchesPhoto(selfie: { sha256: string; dhash: string }, photos: { sha256: string; dhash: string }[]): boolean {
  return photos.some((p) => p.sha256 === selfie.sha256 || hashesLookSame(p.dhash, selfie.dhash))
}
