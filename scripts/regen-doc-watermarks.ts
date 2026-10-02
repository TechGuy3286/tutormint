/**
 * scripts/regen-doc-watermarks.ts  —  PR106-C §4
 *
 * Re-generate the watermarked PREVIEW for existing documents with the new,
 * clearly-visible watermark. Downloads each ORIGINAL from the private
 * identity-docs bucket, re-runs buildWatermarkedPreview, and overwrites the
 * preview object. The original is never touched; a failure leaves the old
 * preview in place.
 *
 *   npx tsx scripts/regen-doc-watermarks.ts            # dry run (counts only)
 *   npx tsx scripts/regen-doc-watermarks.ts --apply    # write (degree certs)
 *   npx tsx scripts/regen-doc-watermarks.ts --apply --kinds=degree,cnic,selfie
 *
 * Reads SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL from .env.local.
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { DOCS_BUCKET, buildWatermarkedPreview } from '../lib/documents'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)

const apply = process.argv.includes('--apply')
const kindsArg = process.argv.find((a) => a.startsWith('--kinds='))
const kinds = (kindsArg ? kindsArg.slice('--kinds='.length) : 'degree').split(',').map((s) => s.trim()).filter(Boolean)

async function main() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE env in .env.local')
  const db = createClient(url, key, { auth: { persistSession: false } })

  const { data: docs, error } = await db
    .from('user_documents')
    .select('id, kind, original_path, preview_path')
    .in('kind', kinds)
  if (error) throw error

  const targets = (docs ?? []).filter((d) => d.original_path && d.preview_path)
  console.log(`kinds=${kinds.join(',')} | documents to regenerate: ${targets.length}${apply ? '' : ' (dry run — pass --apply to write)'}`)
  if (!apply) return

  let ok = 0
  let failed = 0
  for (const d of targets) {
    try {
      const dl = await db.storage.from(DOCS_BUCKET).download(d.original_path as string)
      if (dl.error || !dl.data) throw dl.error ?? new Error('download failed')
      const original = Buffer.from(await dl.data.arrayBuffer())
      const preview = await buildWatermarkedPreview(original)
      const up = await db.storage
        .from(DOCS_BUCKET)
        .upload(d.preview_path as string, preview, { contentType: 'image/jpeg', upsert: true })
      if (up.error) throw up.error
      ok++
    } catch (e) {
      failed++
      console.log(`  FAILED ${(d.id as string).slice(0, 8)} (${d.kind}):`, e instanceof Error ? e.message : String(e))
    }
  }
  console.log(`regenerated: ${ok} | failed: ${failed}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
