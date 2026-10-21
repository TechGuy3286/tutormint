// lib/social/crop.ts
//
// Crop a tutor's photo for a social post (the rule is lib/social/cropCore.ts).
// Reads the photo (our public storage URL or a data: URI), turns it upright,
// cuts the square box and returns a JPEG data URI for satori. A silhouette (an
// SVG data URI) is returned unchanged. Any failure returns the source as it
// was, so a post still renders — just uncropped.
//
// Nothing here writes anywhere: the crop exists only inside the PNG.

import sharp from 'sharp'
import { cropBox, NO_ADJUST, type CropAdjust } from '@/lib/social/cropCore'

const OUT_PX = 720
const FETCH_MS = 6000

async function readSource(src: string): Promise<Buffer | null> {
  if (src.startsWith('data:')) {
    if (src.startsWith('data:image/svg')) return null
    const comma = src.indexOf(',')
    if (comma < 0) return null
    const meta = src.slice(0, comma)
    const body = src.slice(comma + 1)
    return meta.includes(';base64') ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body))
  }
  if (!/^https:\/\//.test(src)) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS)
  try {
    const res = await fetch(src, { signal: ctrl.signal })
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function croppedPortrait(src: string, adj: CropAdjust = NO_ADJUST): Promise<string> {
  try {
    const input = await readSource(src)
    if (!input) return src
    const upright = await sharp(input).rotate().toBuffer()
    const meta = await sharp(upright).metadata()
    if (!meta.width || !meta.height) return src
    const box = cropBox(meta.width, meta.height, adj)
    const out = await sharp(upright)
      .extract({ left: box.left, top: box.top, width: box.size, height: box.size })
      .resize(OUT_PX, OUT_PX, { fit: 'cover' })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 86 })
      .toBuffer()
    return `data:image/jpeg;base64,${out.toString('base64')}`
  } catch {
    return src
  }
}
