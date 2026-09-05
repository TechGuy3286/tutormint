import 'server-only'

import QRCode from 'qrcode'

// Server-side assets for the CV: the QR of the public profile URL, and the
// avatar fetched into a data URI so the PDF carries the image in its own bytes
// (no runtime image fetch inside react-pdf to fail the render). Both the page
// (preview QR) and the PDF route use these, so the QR is identical in both.

/** A QR of the profile URL — navy on white, brand tokens only. */
export async function cvQrDataUri(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    margin: 1,
    width: 160,
    color: { dark: '#151E6B', light: '#FFFFFF' }, // BRAND.navy on white
  })
}

/**
 * Fetch a (validated, public) avatar URL into a data URI for the PDF. Bounded
 * and defensive: a slow or failed fetch, a non-image, or an oversized file
 * yields null and the CV falls back to the initials disc — a missing photo must
 * never fail the whole download.
 */
export async function fetchImageDataUri(url: string | null): Promise<string | null> {
  if (!url) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') || 'image/jpeg'
    if (!contentType.startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0 || buf.length > 3_000_000) return null
    return `data:${contentType};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}
