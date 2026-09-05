// scripts/migration/verify-counts.mjs
//
//   ALLOW_REGION_MIGRATION=1 node scripts/migration/verify-counts.mjs \
//     --from=<sydney ref> --to=<mumbai ref>
//
// Compares LIVE per-table row counts (public, auth, storage) between Sydney and
// Mumbai, plus per-bucket object count + bytes, the policy count and the
// realtime publication membership. Reads both sides read-only. Prints a table
// and exits non-zero on any mismatch (production is live, so a tiny drift on an
// append-only log is shown with its delta rather than silently passed).

import { guard, psql } from './_lib.mjs'

function tableCounts(url) {
  const tables = psql(
    url,
    `select schemaname, tablename from pg_tables where schemaname in ('public','auth','storage') order by 1,2`,
  )
  const union = tables
    .map(([s, t]) => `select '${s}.${t}' k, (select count(*) from "${s}"."${t}") n`)
    .join(' union all ')
  const map = new Map()
  for (const [k, n] of psql(url, union)) map.set(k, Number(n))
  return map
}

function buckets(url) {
  const rows = psql(
    url,
    `select b.id,
        (select count(*) from storage.objects o where o.bucket_id=b.id),
        coalesce((select sum((o.metadata->>'size')::bigint) from storage.objects o where o.bucket_id=b.id),0)
      from storage.buckets b order by b.id`,
  )
  const map = new Map()
  for (const [id, n, bytes] of rows) map.set(id, { objects: Number(n), bytes: Number(bytes) })
  return map
}

function scalar(url, sql) {
  return psql(url, sql).map((r) => r[0])
}

async function main() {
  const { env } = guard()
  const syd = env.SYDNEY_DB_URL
  const mum = env.NEW_DB_URL_SESSION

  const sCounts = tableCounts(syd)
  const mCounts = tableCounts(mum)

  const keys = [...new Set([...sCounts.keys(), ...mCounts.keys()])].sort()
  let mism = 0
  const rows = []
  for (const k of keys) {
    const a = sCounts.get(k)
    const b = mCounts.get(k)
    const ok = a === b
    if (!ok) mism++
    rows.push({ k, syd: a ?? '—', mum: b ?? '—', ok })
  }

  console.log('== per-table row counts (public/auth/storage) ==')
  for (const r of rows) {
    if (!r.ok) console.log(`  ✗ ${r.k}: Sydney=${r.syd} Mumbai=${r.mum} (Δ ${Number(r.mum) - Number(r.syd)})`)
  }
  console.log(`  tables: ${keys.length}, mismatches: ${mism}`)
  const sTot = [...sCounts.values()].reduce((a, b) => a + b, 0)
  const mTot = [...mCounts.values()].reduce((a, b) => a + b, 0)
  console.log(`  total rows: Sydney=${sTot} Mumbai=${mTot}`)

  // Buckets
  const sB = buckets(syd)
  const mB = buckets(mum)
  let bMism = 0
  console.log('\n== per-bucket objects / bytes ==')
  for (const id of new Set([...sB.keys(), ...mB.keys()])) {
    const a = sB.get(id) || { objects: 0, bytes: 0 }
    const b = mB.get(id) || { objects: 0, bytes: 0 }
    const ok = a.objects === b.objects && a.bytes === b.bytes
    if (!ok) {
      bMism++
      console.log(`  ✗ ${id}: Sydney ${a.objects}/${a.bytes}b  Mumbai ${b.objects}/${b.bytes}b`)
    } else {
      console.log(`  ✓ ${id}: ${b.objects} objects, ${b.bytes} bytes`)
    }
  }

  // Policies + publication
  const sPol = scalar(syd, 'select count(*) from pg_policies')[0]
  const mPol = scalar(mum, 'select count(*) from pg_policies')[0]
  const sPub = scalar(syd, "select schemaname||'.'||tablename from pg_publication_tables where pubname='supabase_realtime' order by 1").join(',')
  const mPub = scalar(mum, "select schemaname||'.'||tablename from pg_publication_tables where pubname='supabase_realtime' order by 1").join(',')
  console.log('\n== policies / publication ==')
  console.log(`  pg_policies: Sydney=${sPol} Mumbai=${mPol} ${sPol === mPol ? '✓' : '✗'}`)
  console.log(`  supabase_realtime: Sydney=[${sPub}] Mumbai=[${mPub}] ${sPub === mPub ? '✓' : '✗'}`)

  const allOk = mism === 0 && bMism === 0 && sPol === mPol && sPub === mPub
  console.log(`\n${allOk ? '✓ ALL COUNTS MATCH' : '✗ MISMATCH — do not proceed; investigate (do not fix forward)'}`)
  process.exit(allOk ? 0 : 2)
}

main().catch((e) => {
  console.error('\n✗ ' + e.message)
  process.exit(1)
})
