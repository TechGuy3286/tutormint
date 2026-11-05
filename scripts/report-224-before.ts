/**
 * scripts/report-224-before.ts — read-only facts before migration 224:
 * job titles, profile triggers, member counts. Prints no names or contacts.
 *   npx tsx --env-file=.env.local scripts/report-224-before.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await c.connect()
  try {
    const t = await c.query('select name, sort_order from job_titles order by sort_order')
    console.log('job titles:', t.rows.map((r: { name: string; sort_order: number }) => `${r.sort_order}:${r.name}`).join(' | '))
    const tr = await c.query(`select tgname, pg_get_triggerdef(t.oid) d from pg_trigger t where tgrelid = 'public.profiles'::regclass and not tgisinternal order by tgname`)
    for (const r of tr.rows) console.log('trigger', r.tgname, '::', String(r.d).slice(0, 160))
    const cols = await c.query(`select column_name from information_schema.columns where table_schema='public' and table_name='profiles' and column_name in ('cnic_name','display_name','full_name')`)
    console.log('name columns:', cols.rows.map((r: { column_name: string }) => r.column_name))
    const g = await c.query(`select column_name, privilege_type, grantee from information_schema.column_privileges where table_schema='public' and table_name='profiles' and grantee in ('authenticated','anon') and privilege_type='UPDATE' order by 1`)
    console.log('member-updatable profile columns:', [...new Set(g.rows.map((r: { column_name: string }) => r.column_name))].join(', '))
    const n = await c.query(`select role, count(*)::int n from profiles group by role order by role`)
    console.log('profiles by role:', n.rows)
    const f = await c.query(`select pg_get_functiondef('public.tm_member_self_edit'::regproc) d`)
    console.log(String(f.rows[0].d))
    const tp = await c.query(`select count(*)::int n from tutor_profiles tp join profiles p on p.id = tp.id where tp.full_name is distinct from p.full_name`)
    console.log('tutor_profiles.full_name differing from profiles.full_name:', tp.rows[0].n)
  } finally {
    await c.end()
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
