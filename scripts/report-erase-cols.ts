/**
 * scripts/report-erase-cols.ts — READ-ONLY. Nullability and defaults of the
 * columns the account erase clears, and the auth tables that exist. Schema only.
 *   npx tsx --env-file=.env.local scripts/report-erase-cols.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await c.connect()
  const r = await c.query(`
    select table_schema||'.'||table_name t, column_name, is_nullable, data_type, coalesce(column_default,'') d
      from information_schema.columns
     where (table_schema='public' and table_name in ('profiles','tutor_profiles','children','applications','tutor_contact_logs','admin_messages','messages'))
        or (table_schema='auth' and table_name='users')
     order by 1, ordinal_position`)
  for (const x of r.rows) if (x.is_nullable === 'NO' || x.t === 'auth.users') console.log(x.t, x.column_name, x.is_nullable, x.data_type, x.d.slice(0, 40))
  const t = await c.query(`select table_name from information_schema.tables where table_schema='auth' order by 1`)
  console.log('auth tables:', t.rows.map((x: { table_name: string }) => x.table_name).join(', '))
  const ck = await c.query(`select conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid='public.sms_sends'::regclass and contype='c'`)
  console.table(ck.rows)
  const u = await c.query(`select indexname, indexdef from pg_indexes where schemaname='public' and tablename='profiles' and indexdef ilike '%unique%'`)
  for (const x of u.rows) console.log(x.indexdef)
  await c.end()
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
