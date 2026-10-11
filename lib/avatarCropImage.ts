// lib/avatarCropImage.ts
//
// The picture work behind a profile-photo crop (rules: lib/photoCropCore,
// lib/avatarRotationCore). Buffers in, a buffer out — no storage, no database —
// so scripts/test-photo-crop.ts runs the real thing on a generated picture.
// Nothing here can change a stored file: it only ever returns a NEW buffer.

import sharp from 'sharp'

import type { Rotation } from './docRotation'
import { cropPixels, outputSide, type CropRect } from './photoCropCore'

/** The original the right way up (EXIF), then turned by the saved rotation. */
export async function uprightTurned(original: Buffer, rotation: Rotation): Promise<Buffer> {
  const upright = await sharp(original, { failOn: 'none' }).rotate().toBuffer()
  return rotation === 0 ? upright : sharp(upright).rotate(rotation).toBuffer()
}

/**
 * The cropped square copy: the original, turned by the saved rotation, cut to
 * the crop, at least 512 × 512, as a JPEG.
 */
export async function renderCroppedCopy(original: Buffer, rotation: Rotation, crop: CropRect): Promise<{ buffer: Buffer; side: number }> {
  const turned = await uprightTurned(original, rotation)
  const meta = await sharp(turned).metadata()
  const w = meta.width ?? 0
  const h = meta.height ?? 0
  if (!w || !h) throw new Error('not an image')
  const px = cropPixels(crop, w, h)
  const side = outputSide(px.side)
  const buffer = await sharp(turned)
    .extract({ left: px.left, top: px.top, width: px.side, height: px.side })
    .resize(side, side, { fit: 'fill' })
    .jpeg({ quality: 90 })
    .toBuffer()
  return { buffer, side }
}

/** The picture the crop frame shows staff: upright, turned, at most 1600 px. */
export async function renderCropSource(original: Buffer, rotation: Rotation): Promise<Buffer> {
  const turned = await uprightTurned(original, rotation)
  return sharp(turned).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer()
}

/**
 * A member upload, made safe to store: the photo as uploaded (upright, at most
 * 1600 px, metadata such as GPS removed) and their square (at least 512).
 */
export async function normaliseMemberPhoto(original: Buffer, crop: Buffer): Promise<{ original: Buffer; crop: Buffer }> {
  const o = await sharp(original, { failOn: 'none' })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 86 })
    .toBuffer()
  const meta = await sharp(crop, { failOn: 'none' }).metadata()
  const side = outputSide(Math.min(meta.width ?? 0, meta.height ?? 0))
  const c = await sharp(crop, { failOn: 'none' }).rotate().resize(side, side, { fit: 'cover', position: 'centre' }).jpeg({ quality: 90 }).toBuffer()
  return { original: o, crop: c }
}
