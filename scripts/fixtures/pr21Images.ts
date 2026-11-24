// scripts/fixtures/pr21Images.ts — INVENTED test images for PR-21 ("Read from
// image" on Vercel; Urdu digits). Built in memory; every name, place and
// number here is made up (0300 1234567 is not a real line).

import sharp from 'sharp'

function svg(lines: { text: string; size: number; fill: string }[], bg: string, w: number, h: number): string {
  let y = Math.round(h * 0.15)
  const t = lines
    .map((l) => {
      const out = `<text x="${w / 2}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${l.size}" font-weight="bold" fill="${l.fill}" text-anchor="middle">${l.text}</text>`
      y += Math.round(l.size * 1.9)
      return out
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/>${t}</svg>`
}

/** The Owner's kind of poster, at phone-photo size (3024 × 4032 JPEG):
 *  "We are hiring — Geography / History Teacher — Contact via WhatsApp — Township, Lahore". */
export async function phonePhotoPoster(): Promise<Buffer> {
  const w = 1080
  const h = 1440
  const s = svg(
    [
      { text: 'We are hiring', size: 104, fill: 'white' },
      { text: 'Geography / History Teacher', size: 62, fill: 'white' },
      { text: 'Contact via WhatsApp', size: 58, fill: 'white' },
      { text: '0300-1234567', size: 78, fill: 'white' },
      { text: 'Township, Lahore', size: 58, fill: 'white' },
    ],
    '#123a6b',
    w,
    h,
  )
  return sharp(Buffer.from(s)).resize({ width: 3024 }).jpeg({ quality: 88 }).toBuffer()
}

/** The invented number in Urdu digits on a line WITHOUT any contact word —
 *  the PR-20 gap (only رابطہ / نمبر lines were read in Urdu). */
export async function urduDigitsNoContactWord(): Promise<Buffer> {
  const s = svg(
    [
      { text: 'Home tutor needed, Model Colony Karachi', size: 44, fill: '#111111' },
      { text: '۰۳۰۰ ۱۲۳۴۵۶۷', size: 72, fill: '#111111' },
    ],
    '#ffffff',
    1000,
    600,
  )
  return sharp(Buffer.from(s)).png().toBuffer()
}

/** A GIF (not a type we read). */
export async function gifImage(): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 40, channels: 3, background: '#ffffff' } }).gif().toBuffer()
}

/** The first bytes of an iPhone HEIC photo (an ISO-BMFF "ftypheic" box) — enough
 *  for a decoder to call it HEIC; there is no picture in it. */
export function heicHeader(): Buffer {
  const b = Buffer.alloc(64)
  b.writeUInt32BE(24, 0)
  b.write('ftypheic', 4, 'ascii')
  b.write('mif1heic', 16, 'ascii')
  return b
}
