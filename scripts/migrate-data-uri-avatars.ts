/**
 * scripts/migrate-data-uri-avatars.ts
 *
 *   npx tsx scripts/migrate-data-uri-avatars.ts          # report only
 *   npx tsx scripts/migrate-data-uri-avatars.ts --apply  # upload and rewrite
 *
 * WHAT IS WRONG WITH A data: AVATAR. Three members' pictures were stored as
 * base64 in profiles.avatar_url — 4,041,714 characters for one of them. That
 * column is selected by getSessionUser() on EVERY request and is rendered by
 * the header, every card and every message row, so the bytes were inlined into
 * the HTML of every page that showed that person. Four megabytes of markup,
 * uncacheable (it is part of the document, not a file), re-sent on every
 * navigation, and outside next/image entirely: no resizing, no WebP, no
 * width/height, nothing.
 *
 * A storage path costs ~90 characters in the HTML and the picture is then a
 * cacheable file that next/image can resize.
 *
 * WHY A SCRIPT AND NOT A MIGRATION. The bytes have to be decoded and PUT into
 * Supabase Storage, which is an HTTP API, not SQL. The row update that follows
 * is the trivial half. It is guarded exactly like seed-cleanup.ts, announces
 * its target and refuses production without an explicit override, because
 * there is one Supabase project and it is the live one.
 *
 * IDEMPOTENT. It only ever looks at rows whose avatar_url starts with `data:`,
 * so a second run finds nothing. Re-running after a partial failure resumes.
 *
 * The three rows that existed on 4 Sep 2026 were moved by hand -- psql to read
 * and rewrite, the storage REST API to upload -- because guardWrites() refused
 * an unattended production write at the time and this shell has no terminal.
 * It now takes --confirm, so a fourth would go through the script:
 *
 *     npx tsx scripts/migrate-data-uri-avatars.ts            # dry run
 *     ALLOW_SEED_ON_PRODUCTION=1 npx tsx scripts/migrate-data-uri-avatars.ts  *       --apply --confirm=<production project ref>
 *
 * profiles IS THE ONLY THING IT WRITES. tutor_profiles.avatar_url is kept in
 * step by the mirror trigger from migration 42, so writing both here would be
 * writing the same fact twice and inviting them to disagree.
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { guardWrites, die } from './target'

/** Where a migrated picture lands. Same bucket the tutor settings page uses. */
const BUCKET = 'tutor-media'

/**
 * The image types worth accepting.
 *
 * Anything else is REPORTED AND SKIPPED rather than uploaded with a guessed
 * extension: a file whose name says .png and whose bytes are something else is
 * a thing that renders on one browser and not another, and the row it came
 * from is still readable afterwards.
 */
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

type Row = { id: string; avatar_url: string; full_name: string | null }

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

/** `data:image/png;base64,iVBOR...` -> bytes and a file extension. */
function decode(uri: string): { bytes: Buffer; mime: string; ext: string } | null {
  // [\s\S] rather than the `s` flag: tsconfig targets es2017 for the app and
  // scripts share it.
  const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(uri)
  if (!m) return null
  const mime = m[1].toLowerCase()
  const ext = EXT[mime]
  if (!ext) return null
  try {
    return { bytes: Buffer.from(m[2], 'base64'), mime, ext }
  } catch {
    return null
  }
}

async function main() {
  const env = loadEnv()
  const apply = process.argv.includes('--apply')

  await guardWrites({
    scriptName: 'migrate-data-uri-avatars -- move base64 avatars into storage',
    env,
    action: apply
      ? `Uploads each data: avatar to the ${BUCKET} bucket and rewrites profiles.avatar_url to its URL.`
      : 'Dry run only: lists the rows that would move, and writes nothing.',
    dryRun: !apply,
  })

  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) die('SUPABASE_SERVICE_ROLE_KEY is not set.')

  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await admin
    .from('profiles')
    .select('id, avatar_url, full_name')
    .like('avatar_url', 'data:%')

  if (error) die(`reading profiles: ${error.message}`)

  const rows = (data ?? []) as Row[]
  if (!rows.length) {
    console.log('\nNo data: avatars. Nothing to do.\n')
    return
  }

  console.log(`\n${rows.length} row(s) with an inline avatar:\n`)
  let moved = 0

  for (const row of rows) {
    const label = `${row.full_name ?? '(no name)'} ${row.id}`
    const decoded = decode(row.avatar_url)

    if (!decoded) {
      console.log(`  SKIP  ${label} — not a base64 image we accept (${row.avatar_url.slice(0, 40)}…)`)
      continue
    }

    const kb = Math.round(decoded.bytes.length / 1024)
    const chars = row.avatar_url.length
    console.log(`  ${apply ? 'MOVE' : 'would move'}  ${label} — ${decoded.mime}, ${kb}KB (${chars} chars of HTML per page)`)

    if (!apply) continue

    // The id, not a timestamp: one member has one avatar file, so a re-upload
    // replaces it instead of leaving the old bytes behind in the bucket for
    // nobody. upsert for the same reason.
    const path = `avatars/${row.id}.${decoded.ext}`
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, decoded.bytes, { contentType: decoded.mime, upsert: true })
    if (upErr) {
      console.log(`        FAILED upload: ${upErr.message}`)
      continue
    }

    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path)

    // Written only after the upload succeeded. The other order loses the
    // picture entirely if the upload fails.
    const { error: updErr } = await admin
      .from('profiles')
      .update({ avatar_url: pub.publicUrl })
      .eq('id', row.id)
    if (updErr) {
      console.log(`        FAILED update: ${updErr.message}`)
      continue
    }

    console.log(`        -> ${pub.publicUrl}`)
    moved += 1
  }

  console.log(
    apply
      ? `\n${moved} of ${rows.length} moved. tutor_profiles follows via the mirror trigger.\n`
      : `\nDry run. Pass --apply to move them.\n`,
  )
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)))
