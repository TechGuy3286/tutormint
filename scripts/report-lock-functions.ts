/** Read-only: print the live definitions of the field-lock trigger functions and the document_unlocks item CHECK. */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    for (const fn of ['lock_profile_fields', 'lock_tutor_profile_fields', 'mark_photo_rereview']) {
      const r = await c.query(`select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [fn])
      console.log('-----', fn, '\n', r.rows[0]?.d)
    }
    const k = await c.query(`select conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid='public.document_unlocks'::regclass and contype='c'`)
    console.log(k.rows)
    const t = await c.query(`select tgname, tgrelid::regclass::text t from pg_trigger where not tgisinternal and tgrelid in ('public.profiles'::regclass,'public.tutor_profiles'::regclass) order by 2,1`)
    console.log(t.rows.map((x: { t: string; tgname: string }) => `${x.t}.${x.tgname}`).join('\n'))
  } finally { await c.end() }
}
main().catch((e) => { console.error(e); process.exit(1) })
