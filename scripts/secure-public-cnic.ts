/**
 * scripts/secure-public-cnic.ts
 *
 *   npx tsx scripts/secure-public-cnic.ts --phase=copy            # dry run
 *   npx tsx scripts/secure-public-cnic.ts --phase=copy --apply
 *   npx tsx scripts/secure-public-cnic.ts --phase=delete          # dry run
 *   npx tsx scripts/secure-public-cnic.ts --phase=delete --apply
 *   (production needs ALLOW_SEED_ON_PRODUCTION=1 and --confirm=<ref> too)
 *
 * THE DEFECT. The tutor settings page used to upload both sides of a CNIC
 * through the same helper as the avatar, into the PUBLIC tutor-media bucket.
 * Two members' national identity cards were fetchable by URL with no
 * credential at all. The writer was removed on 4 Sep 2026; this script deals
 * with the four objects it left behind.
 *
 * WHY TWO PHASES. One member (Alishba) has her CNIC images NOWHERE except the
 * public bucket — deleting first would destroy her only copies. So:
 *
 *   copy    downloads her two public objects and stores them exactly the way
 *           /api/documents/upload would have: original + watermarked preview
 *           into the private identity-docs bucket, a user_documents row per
 *           side (label 'front' / 'back'), and profiles.cnic_image_path set
 *           to the front's original path (completion + admin queue read it).
 *           The other member (a seed account) already has a private document
 *           row, so nothing is copied for him.
 *
 *   delete  removes all four public objects from tutor-media and clears the
 *           now-dangling cnic_front_url / cnic_back_url values on both
 *           tutor_profiles rows. Run ONLY after the copies have been verified
 *           through /api/documents/<id>/preview.
 *
 * The verification between the phases is the reason they are not one command.
 *
 * IDEMPOTENT. copy skips a side that already has a user_documents row whose
 * original was written by this script (marked in the path); delete is a
 * storage remove plus a NULL update, both harmless to repeat.
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { buildWatermarkedPreview } from '../lib/documents'
import { guardWrites, die } from './target'

const PUBLIC_BUCKET = 'tutor-media'
const PRIVATE_BUCKET = 'identity-docs'

/** The four exposed objects, verbatim from tutor_profiles on 4 Sep 2026. */
const EXPOSED = [
  {
    userId: 'a412120a-5cb0-4ab4-9749-4f67ff67df76', // Alishba — real member, no private copy
    copy: true,
    sides: {
      front: 'a412120a-5cb0-4ab4-9749-4f67ff67df76-1787918126552.png',
      back: 'a412120a-5cb0-4ab4-9749-4f67ff67df76-1787918138684.png',
    },
  },
  {
    userId: '535aada4-a04d-49c6-8a3d-b48c89c8f491', // Ali Raza — seed, private doc already exists
    copy: false,
    sides: {
      front: '535aada4-a04d-49c6-8a3d-b48c89c8f491-1788468632293.jpeg',
      back: '535aada4-a04d-49c6-8a3d-b48c89c8f491-1788468638750.jpeg',
    },
  },
] as const

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  try {
    for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      if (!line || line.trimStart().startsWith('#') || !line.includes('=')) continue
      const i = line.indexOf('=')
      const k = line.slice(0, i).trim()
      const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
      if (!(k in env) || !env[k]) env[k] = v
    }
  } catch {
    /* optional */
  }
  return env
}

async function main() {
  const env = loadEnv()
  const apply = process.argv.includes('--apply')
  const phaseArg = process.argv.find((a) => a.startsWith('--phase='))
  const phase = phaseArg?.slice('--phase='.length)
  if (phase !== 'copy' && phase !== 'delete') die('Pass --phase=copy or --phase=delete.')

  await guardWrites({
    scriptName: `secure-public-cnic --phase=${phase} -- move public CNIC scans behind the private flow`,
    env,
    action: apply
      ? phase === 'copy'
        ? 'Copies the unprotected CNIC images into identity-docs + user_documents.'
        : 'DELETES the four public CNIC objects from tutor-media and clears the URL columns.'
      : 'Dry run only: reports what would happen, writes nothing.',
    dryRun: !apply,
  })

  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) die('SUPABASE_SERVICE_ROLE_KEY is not set.')
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (phase === 'copy') {
    for (const member of EXPOSED) {
      if (!member.copy) {
        console.log(`skip ${member.userId} — private user_documents row already exists`)
        continue
      }
      for (const side of ['front', 'back'] as const) {
        const key = member.sides[side]

        // Already copied? The path this script writes carries '-migrated-'.
        const { data: existing } = await admin
          .from('user_documents')
          .select('id')
          .eq('user_id', member.userId)
          .eq('kind', 'cnic')
          .eq('label', side)
          .like('original_path', '%-migrated-original%')
          .limit(1)
        if (existing && existing.length > 0) {
          console.log(`skip ${side}: already copied (doc ${existing[0].id})`)
          continue
        }

        const { data: file, error: dlErr } = await admin.storage.from(PUBLIC_BUCKET).download(key)
        if (dlErr || !file) die(`Could not download ${key}: ${dlErr?.message}`)
        const bytes = Buffer.from(await file.arrayBuffer())
        console.log(`${side}: ${key} (${bytes.byteLength} bytes)`)

        if (!apply) continue

        const preview = await buildWatermarkedPreview(bytes)
        const stamp = Date.now()
        const originalPath = `${member.userId}/cnic/${stamp}-migrated-original`
        const previewPath = `${member.userId}/cnic/${stamp}-migrated-preview.jpg`

        const up1 = await admin.storage
          .from(PRIVATE_BUCKET)
          .upload(originalPath, bytes, { contentType: 'image/png', upsert: false })
        if (up1.error) die(`upload original failed: ${up1.error.message}`)
        const up2 = await admin.storage
          .from(PRIVATE_BUCKET)
          .upload(previewPath, preview, { contentType: 'image/jpeg', upsert: false })
        if (up2.error) die(`upload preview failed: ${up2.error.message}`)

        const { data: doc, error: insErr } = await admin
          .from('user_documents')
          .insert({
            user_id: member.userId,
            kind: 'cnic',
            label: side,
            original_path: originalPath,
            preview_path: previewPath,
          })
          .select('id')
          .single()
        if (insErr) die(`user_documents insert failed: ${insErr.message}`)
        console.log(`  -> doc ${doc.id}  preview /api/documents/${doc.id}/preview`)

        if (side === 'front') {
          const { error: upErr } = await admin
            .from('profiles')
            .update({ cnic_image_path: originalPath })
            .eq('id', member.userId)
          if (upErr) die(`cnic_image_path update failed: ${upErr.message}`)
          console.log('  -> profiles.cnic_image_path set')
        }
      }
    }
    console.log('\ncopy phase done. Verify the previews, then run --phase=delete.')
    return
  }

  // phase === 'delete'
  const keys = EXPOSED.flatMap((m) => [m.sides.front, m.sides.back])
  for (const k of keys) console.log(`delete public/${PUBLIC_BUCKET}/${k}`)
  if (!apply) return

  const { data: removed, error: rmErr } = await admin.storage.from(PUBLIC_BUCKET).remove([...keys])
  if (rmErr) die(`storage remove failed: ${rmErr.message}`)
  console.log(`removed ${removed?.length ?? 0} objects at ${new Date().toISOString()}`)

  for (const m of EXPOSED) {
    const { error } = await admin
      .from('tutor_profiles')
      .update({ cnic_front_url: null, cnic_back_url: null })
      .eq('id', m.userId)
    if (error) die(`clearing URL columns failed for ${m.userId}: ${error.message}`)
  }
  console.log('cnic_front_url / cnic_back_url cleared on both rows.')
}

main().catch((e) => die(String(e?.stack || e)))
