// lib/imageCompress.ts
//
// Client-side image compression, run in the BROWSER before an upload leaves the
// phone (owner, 15 Sep 2026). A modern Android camera photo is 4-8 MB; the
// selfie and CNIC uploads POST through a Next/Vercel API route whose request
// body is capped around 4.5 MB, so a raw camera file is rejected at the edge
// with a 413 that surfaces as an opaque "Upload failed." (The profile photo
// worked only because it uploads straight to Supabase storage, bypassing the
// route.) Resizing to a sane max edge and re-encoding as JPEG brings every photo
// well under the cap — and off a data plan.
//
// Uses the canvas API (no dependency). If anything goes wrong it returns the
// ORIGINAL file rather than blocking the upload — a slightly-large photo that
// still uploads beats a hard failure.

const DEFAULT_MAX_EDGE = 1600
const DEFAULT_QUALITY = 0.82

/** Load a File into an HTMLImageElement via an object URL, always revoking it. */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('not an image'))
    }
    img.src = url
  })
}

/**
 * Resize `file` so its longest edge is at most `maxEdge` and re-encode it as a
 * JPEG. Returns a NEW File (same base name, `.jpg`), or the original file
 * unchanged when it is not a raster image, is already small, or the canvas
 * pipeline is unavailable.
 */
export async function compressImage(
  file: File,
  { maxEdge = DEFAULT_MAX_EDGE, quality = DEFAULT_QUALITY }: { maxEdge?: number; quality?: number } = {},
): Promise<File> {
  // Only raster photos. A PDF or an already-tiny image is left alone.
  if (typeof document === 'undefined' || !file.type.startsWith('image/')) return file

  let img: HTMLImageElement
  try {
    img = await loadImage(file)
  } catch {
    return file // let the server decide; never block on our own optimisation
  }

  const longest = Math.max(img.width, img.height)
  const scale = longest > maxEdge ? maxEdge / longest : 1
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(img, 0, 0, w, h)

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality),
  )
  if (!blob) return file

  // Never hand back something LARGER than the original (a small PNG can grow).
  if (blob.size >= file.size && scale === 1) return file

  const base = file.name.replace(/\.[^.]+$/, '') || 'photo'
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
}
