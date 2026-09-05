// scripts/migration/copy-storage.mjs
//
//   ALLOW_REGION_MIGRATION=1 node scripts/migration/copy-storage.mjs \
//     --from=<sydney ref> --to=<mumbai ref>
//
// Copies every storage object's BYTES from Sydney to Mumbai (the DB restore
// already brought the object metadata ROWS; this brings the file content). For
// each object it downloads from Sydney and uploads to Mumbai with upsert,
// preserving content-type and the DB-stored cache-control — an upsert onto the
// restored row keeps its owner, so identity-docs RLS ("owner or admin") is
// intact. Private buckets stay private; their policies were already copied.
//
// Identity documents (and every object) pass through MEMORY ONLY — the bytes are
// held in a Buffer and never written to disk.
//
// Verifies per bucket: object count equal, total bytes equal, and a random 5%
// sample equal by SHA-256 (downloaded from both sides and hashed).

import { createHash } from 'node:crypto'
import { guard, psql } from './_lib.mjs'

const H = (k) => ({ Authorization: `Bearer ${k}`, apikey: k })
const enc = (name) => name.split('/').map(encodeURIComponent).join('/')

function objectsOf(url) {
  // Source of truth: Sydney's storage.objects — name, bucket, and the stored
  // content-type + cache-control so the copy preserves them exactly.
  return psql(
    url,
    `select bucket_id, name,
        coalesce(metadata->>'mimetype','application/octet-stream'),
        coalesce(metadata->>'cacheControl','max-age=3600'),
        coalesce(metadata->>'size','0')
      from storage.objects order by bucket_id, name`,
  ).map(([bucket, name, mimetype, cacheControl, size]) => ({ bucket, name, mimetype, cacheControl, size: Number(size) }))
}

async function download(env, base, key, o) {
  const r = await fetch(`${base}/storage/v1/object/${o.bucket}/${enc(o.name)}`, { headers: H(key) })
  if (!r.ok) throw new Error(`download ${o.bucket}/${o.name} -> ${r.status} ${(await r.text()).slice(0, 120)}`)
  return Buffer.from(await r.arrayBuffer())
}

async function upload(base, key, o, buf) {
  const r = await fetch(`${base}/storage/v1/object/${o.bucket}/${enc(o.name)}`, {
    method: 'PUT',
    headers: { ...H(key), 'Content-Type': o.mimetype, 'Cache-Control': o.cacheControl, 'x-upsert': 'true' },
    body: buf,
  })
  if (!r.ok) throw new Error(`upload ${o.bucket}/${o.name} -> ${r.status} ${(await r.text()).slice(0, 120)}`)
}

async function pool(items, n, fn) {
  const results = []
  let i = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const idx = i++
        results[idx] = await fn(items[idx], idx)
      }
    }),
  )
  return results
}

async function main() {
  const { env } = guard()
  const SYD = env.SYDNEY_URL
  const SK = env.SYDNEY_SERVICE_ROLE_KEY
  const MUM = env.NEW_SUPABASE_URL
  const MK = env.NEW_SERVICE_ROLE_KEY

  const objects = objectsOf(env.SYDNEY_DB_URL)
  console.log(`Copying ${objects.length} objects across ${new Set(objects.map((o) => o.bucket)).size} buckets…`)

  let done = 0
  let failed = 0
  await pool(objects, 6, async (o) => {
    try {
      const buf = await download(env, SYD, SK, o)
      await upload(MUM, MK, o, buf)
      done++
      if (done % 25 === 0) console.log(`  …${done}/${objects.length}`)
    } catch (e) {
      failed++
      console.error('  ✗ ' + e.message)
    }
  })
  console.log(`Copied ${done}/${objects.length} (${failed} failed).`)
  if (failed > 0) throw new Error(`${failed} objects failed to copy — stopping.`)

  // ---- verify ----
  const sByBucket = psql(
    env.SYDNEY_DB_URL,
    `select bucket_id, count(*), coalesce(sum((metadata->>'size')::bigint),0) from storage.objects group by 1 order by 1`,
  )
  const mByBucket = new Map(
    psql(
      env.NEW_DB_URL_SESSION,
      `select bucket_id, count(*), coalesce(sum((metadata->>'size')::bigint),0) from storage.objects group by 1 order by 1`,
    ).map(([b, n, by]) => [b, { n: Number(n), bytes: Number(by) }]),
  )
  console.log('\n== per-bucket verify (count / bytes) ==')
  let vbad = 0
  for (const [b, n, by] of sByBucket) {
    const m = mByBucket.get(b) || { n: 0, bytes: 0 }
    const ok = Number(n) === m.n && Number(by) === m.bytes
    if (!ok) vbad++
    console.log(`  ${ok ? '✓' : '✗'} ${b}: Sydney ${n}/${by}b  Mumbai ${m.n}/${m.bytes}b`)
  }

  // random 5% SHA-256 sample (at least 1 per non-empty bucket)
  const byBucket = new Map()
  for (const o of objects) {
    if (!byBucket.has(o.bucket)) byBucket.set(o.bucket, [])
    byBucket.get(o.bucket).push(o)
  }
  const sample = []
  for (const [, list] of byBucket) {
    const k = Math.max(1, Math.ceil(list.length * 0.05))
    const shuffled = [...list].sort(() => Math.random() - 0.5)
    sample.push(...shuffled.slice(0, k))
  }
  console.log(`\n== SHA-256 sample (${sample.length} objects, ~5%) ==`)
  let sbad = 0
  await pool(sample, 6, async (o) => {
    const [a, b] = await Promise.all([download(env, SYD, SK, o), download(env, MUM, MK, o)])
    const ha = createHash('sha256').update(a).digest('hex')
    const hb = createHash('sha256').update(b).digest('hex')
    if (ha !== hb) {
      sbad++
      console.log(`  ✗ ${o.bucket}/${o.name}: sha differ`)
    }
  })
  console.log(`  ${sample.length - sbad}/${sample.length} sampled objects byte-identical.`)

  const ok = vbad === 0 && sbad === 0 && failed === 0
  console.log(`\n${ok ? '✓ STORAGE COPY VERIFIED' : '✗ STORAGE MISMATCH'}`)
  process.exit(ok ? 0 : 2)
}

main().catch((e) => {
  console.error('\n✗ ' + e.message)
  process.exit(1)
})
