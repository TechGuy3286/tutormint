/**
 * scripts/report-224-tp-triggers.ts — read-only: tutor_profiles triggers and the
 * body of any that read full_name (to see if a name change moves the slug).
 *   npx tsx --env-file=.env.local scripts/report-224-tp-triggers.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await c.connect()
  try {
    const tr = await c.query(`select tgname, pg_get_triggerdef(t.oid) d, p.proname, pg_get_functiondef(p.oid) body
      from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      where tgrelid = 'public.tutor_profiles'::regclass and not tgisinternal order by tgname`)
    for (const r of tr.rows) {
      console.log('trigger', r.tgname, '::', String(r.d).slice(0, 200))
      if (/full_name/.test(String(r.body))) console.log(String(r.body))
    }
    const f = await c.query(`select pg_get_functiondef('public.profiles_sync_tuitions'::regproc) d`)
    console.log(String(f.rows[0].d).slice(0, 1500))
  } finally {
    await c.end()
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
