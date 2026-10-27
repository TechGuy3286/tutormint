/**
 * scripts/report-merge-schema.ts — READ ONLY (owner, 27 Oct 2026).
 * Indexes on profiles touching cnic / phone, address columns, credit columns,
 * NOT NULL columns of tutor_profiles without a default, and triggers on jobs.
 *   npx tsx --env-file=.env.local scripts/report-merge-schema.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const ix = await c.query(`select indexname, indexdef from pg_indexes where schemaname='public' and tablename='profiles' and (indexdef ilike '%cnic%' or indexdef ilike '%phone%' or indexdef ilike '%unique%')`)
    for (const r of ix.rows) console.log('INDEX', r.indexname, '|', r.indexdef)
    const cols = await c.query(`select table_name, column_name, is_nullable, column_default from information_schema.columns where table_schema='public'
      and ((table_name='profiles' and column_name like 'address%') or table_name in ('staff_signup_credits','children'))
      order by table_name, ordinal_position`)
    for (const r of cols.rows) console.log('COL', r.table_name, r.column_name, r.is_nullable, r.column_default ?? '')
    const nn = await c.query(`select column_name from information_schema.columns where table_schema='public' and table_name='tutor_profiles' and is_nullable='NO' and column_default is null`)
    console.log('tutor_profiles NOT NULL no default:', nn.rows.map((r: { column_name: string }) => r.column_name))
    const tg = await c.query(`select tgname, pg_get_triggerdef(t.oid) d from pg_trigger t join pg_class cl on cl.oid=t.tgrelid where cl.relname in ('jobs','children','user_documents') and not tgisinternal`)
    for (const r of tg.rows) console.log('TRIGGER', r.tgname, '|', r.d)
  } finally {
    await c.end()
  }
}
main().catch((e) => { console.error(e.message); process.exit(1) })
