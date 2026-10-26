/** Read-only: every column that points at a member (profiles.id / auth.users.id), and each table's primary and unique keys — for the merge plan (owner, 26 Oct 2026).
 *   npx tsx --env-file=.env.local scripts/report-merge-keys.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await c.connect()
  try {
    const fks = await c.query(`
      select tc.table_name, kcu.column_name, ccu.table_schema as ref_schema, ccu.table_name as ref_table, rc.delete_rule
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
      join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
        and ((ccu.table_schema = 'public' and ccu.table_name = 'profiles' and ccu.column_name = 'id') or (ccu.table_schema = 'auth' and ccu.table_name = 'users'))
      order by 1, 2`)
    console.log('FK columns pointing at a member:')
    for (const r of fks.rows) console.log(`  ${r.table_name}.${r.column_name} -> ${r.ref_schema}.${r.ref_table} (${r.delete_rule})`)
    const tables = [...new Set(fks.rows.map((r: { table_name: string }) => r.table_name))]
    const keys = await c.query(
      `select t.relname as table_name, con.conname, con.contype, pg_get_constraintdef(con.oid) as def
       from pg_constraint con join pg_class t on t.oid = con.conrelid join pg_namespace n on n.oid = t.relnamespace
       where n.nspname = 'public' and con.contype in ('p','u') and t.relname = any($1) order by 1, 2`,
      [tables],
    )
    console.log('\nPrimary / unique keys:')
    for (const r of keys.rows) console.log(`  ${r.table_name}: ${r.contype} ${r.def}`)
    const idx = await c.query(
      `select tablename, indexdef from pg_indexes where schemaname = 'public' and tablename = any($1) and indexdef ilike '%unique%' order by 1`,
      [tables],
    )
    console.log('\nUnique indexes:')
    for (const r of idx.rows) console.log(`  ${r.tablename}: ${r.indexdef.replace(/^CREATE UNIQUE INDEX /, '')}`)
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
