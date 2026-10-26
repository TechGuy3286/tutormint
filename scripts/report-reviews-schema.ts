/**
 * scripts/report-reviews-schema.ts — READ-ONLY. The reviews table's policies,
 * triggers, indexes and every function that reads it (owner, 27 Oct 2026).
 *   npx tsx --env-file=.env.local scripts/report-reviews-schema.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await c.connect()
  const show = async (label: string, sql: string) => {
    const r = await c.query(sql)
    console.log(`\n== ${label}`)
    for (const row of r.rows) console.log(JSON.stringify(row))
  }
  await show('policies', `select policyname, permissive, cmd, roles::text, qual, with_check from pg_policies where tablename='reviews'`)
  await show('triggers', `select tgname, pg_get_triggerdef(t.oid) d from pg_trigger t where tgrelid='public.reviews'::regclass and not tgisinternal`)
  await show('indexes', `select indexname, indexdef from pg_indexes where tablename='reviews'`)
  await show('columns', `select column_name, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='reviews'`)
  await show('grants', `select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='reviews' and grantee in ('anon','authenticated')`)
  await show('functions reading reviews', `select p.proname, pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosrc ilike '%reviews%'`)
  await show('application stages', `select stage, count(*) from applications group by 1`)
  await c.end()
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
