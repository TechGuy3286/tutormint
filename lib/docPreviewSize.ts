// lib/docPreviewSize.ts — identity-document thumbnails at phone size (owner,
// 28 Oct 2026 — site speed).
//
// PURE. CNIC sides, selfies and degree certificates are PRIVATE: they are never
// handed to Next's image optimiser (its output is cached and served to anyone
// with the address) and never get a public URL. Instead their one authorising
// route (/api/documents/[id]/preview) can return a smaller copy: `?w=` picks one
// of a few fixed widths, the route resizes on the way out and still answers
// `Cache-Control: private, no-store`. The full-size view asks for no width.

export const PREVIEW_WIDTHS = [160, 320, 640] as const
export type PreviewWidth = (typeof PREVIEW_WIDTHS)[number]
/** What a thumbnail card asks for: sharp on a phone at 2x, a fraction of the full file. */
export const THUMB_WIDTH: PreviewWidth = 640

/** The width a request asked for, only when it is one of the fixed widths. */
export function previewWidth(raw: string | null | undefined): PreviewWidth | null {
  const n = Number(raw)
  return (PREVIEW_WIDTHS as readonly number[]).includes(n) ? (n as PreviewWidth) : null
}

/** The preview address for a document, optionally at a fixed width. */
export function previewSrc(documentId: string, opts: { width?: PreviewWidth | null; version?: number } = {}): string {
  const q = new URLSearchParams()
  if (opts.width) q.set('w', String(opts.width))
  if (opts.version) q.set('r', String(opts.version))
  const s = q.toString()
  return `/api/documents/${documentId}/preview${s ? `?${s}` : ''}`
}
