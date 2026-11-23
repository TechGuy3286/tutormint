// scripts/fixtures/pr20Images.ts — INVENTED test images for PR-20 Part C
// ("Read from image"). Built in memory from SVG; every name, place and number
// here is made up (the mobile is 0300 1234567, not a real line).

import sharp from 'sharp'

export const INVENTED_MOBILE = '923001234567'

function svgPoster(lines: { text: string; size: number; fill: string; weight?: string }[], bg: string, w = 1080, h = 1350): string {
  let y = 160
  const t = lines
    .map((l) => {
      const out = `<text x="${w / 2}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${l.size}" font-weight="${l.weight ?? 'bold'}" fill="${l.fill}" text-anchor="middle">${l.text}</text>`
      y += Math.round(l.size * 1.9)
      return out
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/>${t}</svg>`
}

/** "We are hiring — Geography/History Teacher — Township, Lahore — WhatsApp number" on a dark poster. */
export async function hiringPoster(): Promise<Buffer> {
  const svg = svgPoster(
    [
      { text: 'WE ARE HIRING', size: 96, fill: 'white' },
      { text: 'Geography / History Teacher', size: 60, fill: 'white' },
      { text: 'Bright Future Academy', size: 54, fill: 'white' },
      { text: 'Township, Lahore', size: 54, fill: 'white' },
      { text: 'Classes 6 to 10 · Female preferred', size: 44, fill: 'white', weight: 'normal' },
      { text: 'WhatsApp: 0300 1234567', size: 64, fill: 'white' },
    ],
    '#7a0d0d',
  )
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/** A plain WhatsApp-style screenshot: dark text on white, the number split by dashes. */
export async function screenshotPost(): Promise<Buffer> {
  const svg = svgPoster(
    [
      { text: 'Home tutor required for Class 4', size: 40, fill: '#111111', weight: 'normal' },
      { text: 'Maths and English, Johar Town Lahore', size: 40, fill: '#111111', weight: 'normal' },
      { text: 'Evening, Mon to Fri, Fee 15000', size: 40, fill: '#111111', weight: 'normal' },
      { text: 'Contact 0300-1234567', size: 40, fill: '#111111', weight: 'normal' },
    ],
    '#ffffff',
    900,
    700,
  )
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer()
}

/** The invented number written in Urdu digits (۰۳۰۰ ۱۲۳۴۵۶۷). */
export async function urduDigitsPoster(): Promise<Buffer> {
  const svg = svgPoster(
    [
      { text: 'Home tutor needed, Model Colony Karachi', size: 44, fill: '#111111', weight: 'normal' },
      { text: 'رابطہ ۰۳۰۰ ۱۲۳۴۵۶۷', size: 64, fill: '#111111' },
    ],
    '#ffffff',
    1000,
    600,
  )
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/** No number at all. */
export async function noNumberPoster(): Promise<Buffer> {
  const svg = svgPoster(
    [
      { text: 'Online Quran teacher needed', size: 52, fill: '#111111' },
      { text: 'Female, evenings', size: 44, fill: '#111111', weight: 'normal' },
    ],
    '#f4f4f4',
    900,
    600,
  )
  return sharp(Buffer.from(svg)).webp().toBuffer()
}
