import 'server-only'

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { SITE_URL } from '@/lib/siteUrl'
import { coverAsset } from './catalog'

// Loading a cover asset into a data URI for the satori render.
//
// satori embeds a data: URI directly and cannot fetch a remote image reliably,
// and on Vercel the public/ folder is served by the CDN — it is NOT on the
// serverless function's filesystem. So we try the local file first (which works
// in dev, in `next build`, and under the test runner) and fall back to fetching
// the CDN-served asset from our own origin. The result is memoised per lambda,
// because a cover render pulls several assets and a preview may be requested
// three times in a row.

const CACHE = new Map<string, string | null>()

async function fromDisk(file: string): Promise<string | null> {
  try {
    const buf = await readFile(path.join(process.cwd(), 'public', 'covers', file))
    if (buf.length === 0) return null
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

async function fromOrigin(file: string): Promise<string | null> {
  try {
    const res = await fetch(`${SITE_URL}/covers/${file}`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') || 'image/png'
    if (!ct.startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length === 0) return null
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/**
 * A cover asset (by slug) as a data URI, or null if it cannot be loaded — a
 * missing asset must never fail the whole render; the composer simply omits that
 * layer. Deterministic and cached.
 */
export async function coverAssetDataUri(slug: string | null | undefined): Promise<string | null> {
  const asset = coverAsset(slug)
  if (!asset) return null
  if (CACHE.has(asset.file)) return CACHE.get(asset.file) ?? null
  const uri = (await fromDisk(asset.file)) ?? (await fromOrigin(asset.file))
  CACHE.set(asset.file, uri)
  return uri
}
