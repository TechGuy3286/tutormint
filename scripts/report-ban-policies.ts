/**
 * scripts/report-ban-policies.ts — READ-ONLY (owner, 14 Oct 2026).
 * The row-level policies on the tables a ban and a lifted ban write to, and
 * the posts columns, so "a Partner may lift a ban, same as ban" can be checked
 * at the database level.
 *   npx tsx --env-file=.env.local scripts/report-ban-policies.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows } = await c.query(
    `select tablename, policyname, cmd, coalesce(qual, '') as qual, coalesce(with_check, '') as chk
       from pg_policies where schemaname = 'public' and tablename in ('profiles', 'penalties_log', 'signup_blocklist')
      order by tablename, cmd, policyname`,
  )
  for (const r of rows as { tablename: string; policyname: string; cmd: string; qual: string; chk: string }[]) {
    console.log(`${r.tablename} · ${r.cmd} · ${r.policyname}\n   using: ${r.qual.replace(/\s+/g, ' ').slice(0, 200)}\n   check: ${r.chk.replace(/\s+/g, ' ').slice(0, 200)}`)
  }
  const { rows: cols } = await c.query(
    `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'posts' and column_name like 'cover%' order by 1`,
  )
  console.log('posts cover columns:', (cols as { column_name: string }[]).map((r) => r.column_name).join(', '))
  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
