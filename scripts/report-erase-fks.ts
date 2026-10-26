/**
 * scripts/report-erase-fks.ts — READ-ONLY. Every foreign key that points at
 * auth.users or public.profiles, with its ON DELETE action, plus the columns
 * that hold personal data and the phone_otps purpose check. Prints schema only.
 *   npx tsx --env-file=.env.local scripts/report-erase-fks.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await c.connect()
  const r = await c.query(`
    select con.conrelid::regclass::text as tbl, a.attname as col, con.confrelid::regclass::text as ref,
           case con.confdeltype when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'r' then 'RESTRICT' when 'a' then 'NO ACTION' when 'd' then 'SET DEFAULT' end as on_delete
      from pg_constraint con
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
     where con.contype = 'f' and con.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass)
       and con.conrelid::regclass::text not like 'auth.%'
     order by on_delete, tbl`)
  console.table(r.rows)
  const p = await c.query(`select conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid='public.phone_otps'::regclass and contype='c'`)
  console.table(p.rows)
  const cols = await c.query(`select table_name, column_name from information_schema.columns where table_schema='public' and table_name in ('profiles','tutor_profiles','tutor_areas','member_notes','messages','payments','user_documents','admin_messages') order by table_name, ordinal_position`)
  const by: Record<string, string[]> = {}
  for (const x of cols.rows) (by[x.table_name] ||= []).push(x.column_name)
  for (const [t, cs] of Object.entries(by)) console.log(t + ': ' + cs.join(', '))
  const trg = await c.query(`select tgname, tgrelid::regclass::text t, pg_get_triggerdef(oid) d from pg_trigger where tgrelid in ('public.member_notes'::regclass,'public.profiles'::regclass,'public.tutor_profiles'::regclass,'public.messages'::regclass) and not tgisinternal`)
  for (const x of trg.rows) console.log(x.t, x.tgname, '::', x.d)
  const fn = await c.query(`select pg_get_functiondef('public.member_notes_guard'::regproc) d`).catch(() => ({ rows: [] }))
  for (const x of fn.rows) console.log(x.d)
  const ph = await c.query(`select pg_get_functiondef('public.parent_hide_reason'::regproc) d`).catch(() => ({ rows: [] }))
  for (const x of ph.rows) console.log(x.d)
  await c.end()
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
