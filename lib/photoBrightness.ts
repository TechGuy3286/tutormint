// lib/photoBrightness.ts
//
// Browser only. Reads a picture at BLANK_SIZE × BLANK_SIZE and applies the
// server's blank rule (lib/photoBlankCore pixelsLookBlank), so the selfie camera
// and the profile-photo step refuse a dark frame before it is uploaded. A
// picture that cannot be read is never refused here (the server check is the
// backstop).

import { BLANK_SIZE, pixelsLookBlank } from '@/lib/photoBlankCore'

/** True when the drawn picture looks blank; false when it cannot be read. */
export function sourceLooksBlank(src: CanvasImageSource): boolean {
  try {
    const c = document.createElement('canvas')
    c.width = BLANK_SIZE
    c.height = BLANK_SIZE
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return false
    ctx.drawImage(src, 0, 0, BLANK_SIZE, BLANK_SIZE)
    return pixelsLookBlank(ctx.getImageData(0, 0, BLANK_SIZE, BLANK_SIZE).data)
  } catch {
    return false
  }
}

async function decode(blob: Blob): Promise<CanvasImageSource | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob)
    } catch {
      /* fall back to an <img> */
    }
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

/** True when an image file looks blank; false when it cannot be read. */
export async function blobLooksBlank(blob: Blob): Promise<boolean> {
  const src = await decode(blob)
  return src ? sourceLooksBlank(src) : false
}
