// lib/documents.ts
//
// CNIC scans and degree certificates.
//
// Both the original and a watermarked preview live in the PRIVATE identity-docs
// bucket. Neither has a public URL, ever. Bytes are only reachable through
// /api/documents/[id]/preview, which checks rights per document kind, and that
// route only ever serves the preview -- there is no code path that returns an
// original to a browser.
//
// The preview is downscaled and stamped with a repeating diagonal "TutorMint"
// watermark. Per CLAUDE.md this protects against casual copying; it cannot stop
// screenshots and the Terms must not claim otherwise.

import sharp from 'sharp'
import type { SupabaseClient } from '@supabase/supabase-js'
import { watermarkSvg as buildWatermarkSvg } from '@/lib/watermark'

export const DOCS_BUCKET = 'identity-docs'

const PREVIEW_MAX_EDGE = 1000
const PREVIEW_QUALITY = 72

/**
 * Repeating diagonal wordmark, sized to the image. PR106-C §4: brand navy at
 * 0.30 alpha with a half-opaque white stroke, a dense −30° grid, so it reads on
 * both light scans and dark photographs. Pattern lives in lib/watermark (pure).
 */
function watermarkSvg(width: number, height: number): Buffer {
  return Buffer.from(buildWatermarkSvg(width, height))
}

/** Downscale and watermark. Returns a JPEG buffer. */
export async function buildWatermarkedPreview(input: Buffer): Promise<Buffer> {
  const base = sharp(input, { failOn: 'none' }).rotate() // honour EXIF orientation
  const meta = await base.metadata()

  const resized = await base
    .resize({
      width: Math.min(meta.width ?? PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE),
      height: Math.min(meta.height ?? PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE),
      fit: 'inside',
      withoutEnlargement: true,
    })
    .toBuffer()

  const resizedMeta = await sharp(resized).metadata()
  const w = resizedMeta.width ?? PREVIEW_MAX_EDGE
  const h = resizedMeta.height ?? PREVIEW_MAX_EDGE

  return sharp(resized)
    .composite([{ input: watermarkSvg(w, h), blend: 'over' }])
    .jpeg({ quality: PREVIEW_QUALITY, mozjpeg: true })
    // Strips EXIF (including any GPS coordinates on a phone photo of a CNIC).
    .toBuffer()
}

export type DocumentKind = 'cnic' | 'degree' | 'selfie'

export type StoredDocument = {
  id: string
  kind: DocumentKind
  originalPath: string
  previewPath: string
}

/**
 * Store an uploaded document: original + watermarked preview into the private
 * bucket, then a user_documents row. Returns the row id, which is the only
 * handle the client ever receives -- storage paths never reach the browser.
 *
 * `supabase` must be a client acting as the owning user (RLS applies).
 */
export async function storeDocument(
  supabase: SupabaseClient,
  userId: string,
  kind: DocumentKind,
  file: File,
  label?: string,
  /** The row is written through this client when given (the upload route
   *  passes the service role for CNIC/selfie — members cannot insert those rows
   *  themselves, migration 158) and with this status ('review' = a re-upload of
   *  an approved document, waiting for staff; migration 157). */
  opts?: { db?: SupabaseClient; status?: 'active' | 'review' },
): Promise<{ ok: true; doc: StoredDocument } | { ok: false; error: string }> {
  const bytes = Buffer.from(await file.arrayBuffer())

  if (bytes.byteLength > 8 * 1024 * 1024) {
    return { ok: false, error: 'Document must be 8MB or smaller.' }
  }

  let preview: Buffer
  try {
    preview = await buildWatermarkedPreview(bytes)
  } catch {
    return { ok: false, error: 'That file could not be read as an image. Upload a JPG or PNG.' }
  }

  const stamp = Date.now()
  const originalPath = `${userId}/${kind}/${stamp}-original`
  const previewPath = `${userId}/${kind}/${stamp}-preview.jpg`

  const up1 = await supabase.storage
    .from(DOCS_BUCKET)
    .upload(originalPath, bytes, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (up1.error) return { ok: false, error: up1.error.message }

  const up2 = await supabase.storage
    .from(DOCS_BUCKET)
    .upload(previewPath, preview, { contentType: 'image/jpeg', upsert: false })
  if (up2.error) {
    await supabase.storage.from(DOCS_BUCKET).remove([originalPath])
    return { ok: false, error: up2.error.message }
  }

  const { data, error } = await (opts?.db ?? supabase)
    .from('user_documents')
    .insert({
      user_id: userId,
      kind,
      label: label ?? null,
      original_path: originalPath,
      preview_path: previewPath,
      ...(opts?.status ? { status: opts.status } : {}),
    })
    .select('id')
    .single()

  if (error) {
    await supabase.storage.from(DOCS_BUCKET).remove([originalPath, previewPath])
    return { ok: false, error: error.message }
  }

  return { ok: true, doc: { id: data.id, kind, originalPath, previewPath } }
}
