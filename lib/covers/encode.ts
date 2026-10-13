// lib/covers/encode.ts
//
// A composed cover is painted as a PNG (satori); what is stored and shared is a
// compressed JPEG at 1200x630, under about 250 KB (owner, 14 Oct 2026), so a
// share preview loads quickly on a phone. JPEG rather than WebP because every
// link-preview reader (WhatsApp, Facebook, X) is certain to show it. No
// server-only import: the test runner encodes a real cover with it.

import sharp from 'sharp'

export const COVER_MAX_BYTES = 250_000

/** The PNG as a 1200x630 JPEG at the highest quality that fits the limit. */
export async function coverJpeg(png: Uint8Array, maxBytes = COVER_MAX_BYTES): Promise<Buffer> {
  let out: Buffer = Buffer.alloc(0)
  for (const quality of [88, 80, 72, 64, 56, 48]) {
    out = await sharp(png)
      .resize(1200, 630, { fit: 'cover' })
      .flatten({ background: '#FFFFFF' })
      .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toBuffer()
    if (out.length <= maxBytes) return out
  }
  return out
}
