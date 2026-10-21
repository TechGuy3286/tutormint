/**
 * scripts/socialContactSheet.ts — one image showing social post PNGs side by
 * side, a row per template (square · story · wide). Used by
 * scripts/report-social-picker.ts and the render test's sample mode.
 */
import sharp, { type OverlayOptions } from 'sharp'

export async function contactSheet(rows: { label: string; images: Buffer[] }[], cellHeight = 480): Promise<Buffer> {
  const pad = 24
  const labelH = 40
  const scaled = await Promise.all(
    rows.map(async (r) =>
      Promise.all(
        r.images.map(async (img) => {
          const out = await sharp(img).resize({ height: cellHeight }).png().toBuffer()
          const meta = await sharp(out).metadata()
          return { buf: out, w: meta.width ?? cellHeight }
        }),
      ),
    ),
  )
  const width = Math.max(...scaled.map((r) => r.reduce((a, c) => a + c.w + pad, pad)))
  const height = rows.length * (cellHeight + labelH + pad) + pad
  const composites: OverlayOptions[] = []
  rows.forEach((r, ri) => {
    const top = pad + ri * (cellHeight + labelH + pad)
    const label = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${labelH}"><text x="${pad}" y="28" font-family="Arial" font-size="24" font-weight="700" fill="#151E6B">${r.label}</text></svg>`
    composites.push({ input: Buffer.from(label), top, left: 0 })
    let left = pad
    for (const c of scaled[ri]) {
      composites.push({ input: c.buf, top: top + labelH, left })
      left += c.w + pad
    }
  })
  return sharp({ create: { width, height, channels: 3, background: '#E2E8F0' } }).composite(composites).png().toBuffer()
}
