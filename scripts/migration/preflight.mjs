// scripts/migration/preflight.mjs
//
//   ALLOW_REGION_MIGRATION=1 node scripts/migration/preflight.mjs \
//     --from=<sydney ref> --to=<mumbai ref>
//
// READ-ONLY against Sydney. Records everything the restore must reproduce —
// version, extensions, roles, schemas, exact per-table row counts (public, auth,
// storage), per-bucket object counts + bytes, RLS policy count, the realtime
// publication membership, cron jobs, and edge functions — plus a baseline
// median query latency. Writes docs/migration/sydney-preflight.md and a machine
// snapshot next to it. Also asserts Sydney's Postgres major version matches
// Mumbai's, aborting if not.

import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { guard, mgmt, psql, psqlScalar, psqlBin, REPO } from './_lib.mjs'

const SCHEMAS = ['public', 'auth', 'storage']

function tableCounts(url) {
  const tables = psql(
    url,
    `select schemaname, tablename from pg_tables where schemaname in ('public','auth','storage') order by 1,2`,
  )
  if (tables.length === 0) return []
  const union = tables
    .map(([s, t]) => `select '${s}' sch, '${t}' tbl, (select count(*) from "${s}"."${t}") n`)
    .join(' union all ')
  const rows = psql(url, union)
  return rows.map(([sch, tbl, n]) => ({ sch, tbl, n: Number(n) }))
}

function bucketStats(url) {
  const rows = psql(
    url,
    `select b.id, b.public::text,
        (select count(*) from storage.objects o where o.bucket_id=b.id),
        coalesce((select sum((o.metadata->>'size')::bigint) from storage.objects o where o.bucket_id=b.id),0)
      from storage.buckets b order by b.id`,
  )
  return rows.map(([id, pub, n, bytes]) => ({ id, public: pub === 'true', objects: Number(n), bytes: Number(bytes) }))
}

function measureLatency(url) {
  // One psql session, \timing on, a representative read repeated; parse the
  // "Time: N ms" lines and take the median. Same method both sides.
  const q = `select count(*) from public.tutor_directory;`
  const script = `\\timing on\n` + Array(11).fill(q).join('\n') + '\n'
  let out
  try {
    out = execFileSync(psqlBin(), [url, '-X', '-q', '-v', 'ON_ERROR_STOP=1'], { input: script, encoding: 'utf8' })
  } catch {
    return null
  }
  const times = [...out.matchAll(/Time:\s*([\d.]+)\s*ms/g)].map((m) => Number(m[1]))
  times.shift() // drop the first (cold) sample
  if (times.length === 0) return null
  times.sort((a, b) => a - b)
  return times[Math.floor(times.length / 2)]
}

async function main() {
  const { from, to, env } = guard()
  const url = env.SYDNEY_DB_URL
  if (!url) throw new Error('SYDNEY_DB_URL missing from .env.migration')

  const version = psqlScalar(url, 'select version()')
  const major = psqlScalar(url, "select (regexp_match(version(),'PostgreSQL (\\d+)'))[1]")
  const mumMajor = psqlScalar(env.NEW_DB_URL_SESSION, "select (regexp_match(version(),'PostgreSQL (\\d+)'))[1]")
  if (major !== mumMajor) {
    throw new Error(`Postgres major mismatch: Sydney ${major} vs Mumbai ${mumMajor}. Aborting.`)
  }

  const extensions = psql(url, 'select extname, extversion from pg_extension order by 1')
  const roles = psql(url, "select rolname from pg_roles order by 1").map((r) => r[0])
  const schemas = psql(
    url,
    "select nspname from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema' order by 1",
  ).map((r) => r[0])
  const counts = tableCounts(url)
  const buckets = bucketStats(url)
  const policyCount = Number(psqlScalar(url, 'select count(*) from pg_policies'))
  const publication = psql(
    url,
    "select schemaname, tablename from pg_publication_tables where pubname='supabase_realtime' order by 1,2",
  ).map((r) => `${r[0]}.${r[1]}`)

  let cron = []
  const hasCron = psqlScalar(url, "select count(*) from pg_extension where extname='pg_cron'")
  if (Number(hasCron) > 0) {
    cron = psql(url, 'select jobid, schedule, left(command, 80) from cron.job order by jobid').map(
      ([id, sched, cmd]) => ({ id, sched, cmd }),
    )
  }

  let functions = []
  try {
    functions = await mgmt(env, 'GET', `/v1/projects/${from}/functions`)
  } catch (e) {
    functions = [{ _error: e.message }]
  }

  const latency = measureLatency(url)

  const totalRows = counts.reduce((a, c) => a + c.n, 0)
  const bySchema = {}
  for (const c of counts) bySchema[c.sch] = (bySchema[c.sch] || 0) + c.n

  // ---- write the report ----
  const stamp = new Date().toISOString()
  const L = []
  L.push('# Sydney pre-flight — region migration baseline')
  L.push('')
  L.push(`Generated ${stamp} · source project \`${from}\` (ap-southeast-2, READ-ONLY) → target \`${to}\` (ap-south-1).`)
  L.push('')
  L.push('## Postgres')
  L.push(`- ${version}`)
  L.push(`- Major version **${major}** — Mumbai is **${mumMajor}** ✓ match`)
  L.push(`- Median query latency (10× \`count(*) from tutor_directory\`, warm): **${latency ?? 'n/a'} ms**`)
  L.push('')
  L.push(`## Extensions (${extensions.length})`)
  L.push('| extension | version |', '| --- | --- |')
  for (const [n, v] of extensions) L.push(`| ${n} | ${v} |`)
  L.push('')
  L.push(`## Roles (${roles.length})`)
  L.push(roles.map((r) => `\`${r}\``).join(', '))
  L.push('')
  L.push(`## Schemas (${schemas.length})`)
  L.push(schemas.map((s) => `\`${s}\``).join(', '))
  L.push('')
  L.push(`## Row counts — ${totalRows} rows across ${counts.length} tables`)
  L.push(`Per schema: ` + SCHEMAS.map((s) => `**${s}** ${bySchema[s] || 0}`).join(' · '))
  L.push('')
  L.push('| schema | table | rows |', '| --- | --- | ---: |')
  for (const c of counts) L.push(`| ${c.sch} | ${c.tbl} | ${c.n} |`)
  L.push('')
  L.push(`## Storage buckets (${buckets.length})`)
  L.push('| bucket | public | objects | bytes |', '| --- | --- | ---: | ---: |')
  for (const b of buckets) L.push(`| ${b.id} | ${b.public} | ${b.objects} | ${b.bytes} |`)
  const totObj = buckets.reduce((a, b) => a + b.objects, 0)
  const totBytes = buckets.reduce((a, b) => a + b.bytes, 0)
  L.push(`| **total** | | **${totObj}** | **${totBytes}** |`)
  L.push('')
  L.push('## RLS')
  L.push(`- pg_policies count: **${policyCount}**`)
  L.push('')
  L.push(`## Realtime publication \`supabase_realtime\` (${publication.length} tables)`)
  L.push(publication.length ? publication.map((p) => `\`${p}\``).join(', ') : '_none_')
  L.push('')
  L.push(`## Cron jobs (${cron.length})`)
  if (cron.length) {
    L.push('| id | schedule | command |', '| --- | --- | --- |')
    for (const j of cron) L.push(`| ${j.id} | ${j.sched} | ${j.cmd.replace(/\|/g, '\\|')} |`)
  } else L.push('_none (pg_cron not installed or no jobs)_')
  L.push('')
  L.push(`## Edge functions (${Array.isArray(functions) ? functions.length : 0})`)
  if (Array.isArray(functions) && functions.length && !functions[0]._error) {
    for (const f of functions) L.push(`- \`${f.slug}\` (${f.status})`)
  } else if (functions[0] && functions[0]._error) {
    L.push(`_could not list: ${functions[0]._error}_`)
  } else {
    L.push('_none_')
  }
  L.push('')

  const outDir = join(REPO, 'docs', 'migration')
  writeFileSync(join(outDir, 'sydney-preflight.md'), L.join('\n'))
  // Machine snapshot for the count-verification step.
  writeFileSync(
    join(outDir, 'sydney-counts.json'),
    JSON.stringify({ stamp, from, major, counts, buckets, policyCount, publication, cron, latency }, null, 2),
  )
  console.log(`✓ wrote docs/migration/sydney-preflight.md`)
  console.log(`  ${counts.length} tables, ${totalRows} rows; ${buckets.length} buckets, ${totObj} objects, ${totBytes} bytes; ${policyCount} policies; latency ${latency} ms`)
}

main().catch((e) => {
  console.error('\n✗ ' + e.message)
  process.exit(1)
})
