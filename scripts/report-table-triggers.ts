/**
 * scripts/report-table-triggers.ts — READ-ONLY. The triggers on the tables
 * named (default jobs, profiles, staff_signup_credits), with their functions.
 *   npx tsx --env-file=.env.local scripts/report-table-triggers.ts [table ...]
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const tables = process.argv.slice(2).length ? process.argv.slice(2) : ['jobs', 'profiles', 'staff_signup_credits']
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const r = await c.query(
    `select c.relname as tbl, t.tgname, pg_get_triggerdef(t.oid) as def
       from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal and c.relname = any($1) order by 1, 2`,
    [tables],
  )
  for (const row of r.rows) console.log(`${row.tbl}: ${row.def}`)
  const cols = await c.query(
    `select table_name, column_name, data_type, is_nullable, column_default, is_generated, generation_expression
       from information_schema.columns where table_schema='public' and table_name = any($1)
        and column_name in ('status','is_test_name','hidden_from_public','is_suspended','is_banned','staff_id','source','admin_role','deactivated_at')`,
    [tables],
  )
  console.table(cols.rows)
  await c.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
