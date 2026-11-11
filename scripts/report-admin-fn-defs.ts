/**
 * scripts/report-admin-fn-defs.ts — READ-ONLY. Prints the live definitions of
 * the staff-check SQL functions (is_admin, is_admin_writer, …) so a migration
 * is written against what runs, not against an old file. No member data.
 *   npx tsx --env-file=.env.local scripts/report-admin-fn-defs.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows } = await c.query(`
    select p.proname, pg_get_function_identity_arguments(p.oid) args, pg_get_functiondef(p.oid) def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('is_admin','is_admin_writer','is_admin_full_writer','is_admin_with','is_backend_support','sees_all_staff_signups','guard_single_owner')
     order by 1`)
  for (const r of rows) console.log(`\n-- ${r.proname}(${r.args})\n${r.def}`)
  const t = await c.query(`select tgname, pg_get_triggerdef(oid) d from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal and tgname ilike '%owner%'`)
  for (const r of t.rows) console.log(`\n-- trigger ${r.tgname}: ${r.d}`)
  const cols = await c.query(`select column_name from information_schema.columns where table_schema='public' and table_name='profiles' and column_name like 'staff_%'`)
  console.log('\nprofiles staff_* columns:', cols.rows.map((x: { column_name: string }) => x.column_name).join(', ') || 'none')
  const fu = await c.query(`select column_name from information_schema.columns where table_schema='public' and table_name='follow_up_dismissals'`)
  console.log('follow_up_dismissals columns:', fu.rows.map((x: { column_name: string }) => x.column_name).join(', '))
  await c.end()
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
