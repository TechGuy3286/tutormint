/**
 * scripts/build-clean-logos.ts
 *
 *   npx tsx scripts/build-clean-logos.ts
 *
 * The header and footer logo lockups had "Pakistan's Largest Tutors Network"
 * baked into the picture (owner, 14 Oct 2026). This makes a clean copy of each
 * by painting ONLY that tagline line over with the picture's own background —
 * the mark, the wordmark and the colours are untouched, and nothing is redrawn.
 *
 *   public/logo.png                          -> public/brand/tutormint-logo.png
 *   public/TutorMint-Footer-Logo-2448x752.png -> public/brand/tutormint-logo-dark.png
 *   (and a 640px-wide copy of the light one for composed covers)
 *
 * The old files are kept. Re-runnable: it always reads the old files and
 * rewrites the new ones. The tagline is found, not hard-coded: to the right of
 * the mark the ink falls into two horizontal bands (the wordmark, then the
 * tagline) with a clear gap between them; the lower band is the one masked.
 */

import path from 'node:path'
import { mkdirSync } from 'node:fs'
import sharp from 'sharp'

const PUBLIC = path.join(process.cwd(), 'public')
const OUT = path.join(PUBLIC, 'brand')

type Band = { top: number; bottom: number }

async function clean(srcFile: string, outFile: string) {
  const src = path.join(PUBLIC, srcFile)
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  const px = (x: number, y: number) => {
    const i = (y * width + x) * channels
    return [data[i], data[i + 1], data[i + 2], data[i + 3]] as const
  }
  // The background is the colour of the top-left corner.
  const bg = px(4, 4)
  const isInk = (x: number, y: number) => {
    const p = px(x, y)
    return Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 90
  }
  // The mark ends where a full-height column of background begins; the text is
  // to the right of it. Look from one third of the width on.
  const x0 = Math.round(width * 0.33)
  const rows: boolean[] = []
  for (let y = 0; y < height; y++) {
    let ink = 0
    for (let x = x0; x < width; x++) if (isInk(x, y)) ink++
    rows.push(ink > 2)
  }
  const bands: Band[] = []
  let start = -1
  for (let y = 0; y <= height; y++) {
    const on = y < height && rows[y]
    if (on && start < 0) start = y
    if (!on && start >= 0) {
      if (y - start >= 12) bands.push({ top: start, bottom: y - 1 })
      start = -1
    }
  }
  if (bands.length !== 2) {
    throw new Error(`${srcFile}: expected two text bands (wordmark, tagline), found ${bands.length}: ${JSON.stringify(bands)}`)
  }
  const [wordmark, tagline] = bands
  if (tagline.bottom - tagline.top >= wordmark.bottom - wordmark.top) {
    throw new Error(`${srcFile}: the lower band is not smaller than the wordmark — refusing to mask it`)
  }
  // Mask the tagline band (with a small margin), from where the text column
  // starts to the right edge. The margin never reaches the wordmark.
  const pad = Math.min(10, Math.floor((tagline.top - wordmark.bottom) / 2))
  const top = tagline.top - pad
  const bottom = Math.min(height - 1, tagline.bottom + pad)
  // Left edge of the tagline: its first inked column, less a margin.
  let left = width
  for (let y = tagline.top; y <= tagline.bottom; y++) {
    for (let x = x0; x < left; x++) if (isInk(x, y)) { left = x; break }
  }
  left = Math.max(x0, left - 12)
  const mask = await sharp({
    create: { width: width - left, height: bottom - top + 1, channels: 4, background: { r: bg[0], g: bg[1], b: bg[2], alpha: bg[3] / 255 } },
  }).png().toBuffer()

  mkdirSync(OUT, { recursive: true })
  const out = path.join(OUT, outFile)
  await sharp(src).composite([{ input: mask, left, top }]).png({ compressionLevel: 9, palette: true, quality: 95 }).toFile(out)
  console.log(`${srcFile} (${width}x${height}) -> brand/${outFile}; wordmark rows ${wordmark.top}-${wordmark.bottom}, tagline rows ${tagline.top}-${tagline.bottom} masked from x=${left}`)
  return out
}

async function main() {
  const light = await clean('logo.png', 'tutormint-logo.png')
  await clean('TutorMint-Footer-Logo-2448x752.png', 'tutormint-logo-dark.png')
  await sharp(light).resize({ width: 640 }).png({ compressionLevel: 9, palette: true, quality: 95 }).toFile(path.join(OUT, 'tutormint-logo-640.png'))
  console.log('brand/tutormint-logo-640.png written (for composed covers)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
