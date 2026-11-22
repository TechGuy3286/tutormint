/**
 * scripts/report-pr15-registered.ts — READ-ONLY (PR-15). Shows whether the live
 * sign-up trigger (handle_new_user) writes the 'registered' activity row, and
 * how many accounts have more than one 'registered' row, by month. Counts only.
 *   npx tsx --env-file=.env.local scripts/report-pr15-registered.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const def = await c.query(`select pg_get_functiondef('public.handle_new_user()'::regprocedure) d`)
  const body = String(def.rows[0]?.d ?? '')
  console.log('handle_new_user writes registered:', /'registered'/.test(body))
  const trg = await c.query(`select tgname, tgenabled from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal`)
  console.log('auth.users triggers:', trg.rows.map((r: { tgname: string; tgenabled: string }) => `${r.tgname}(${r.tgenabled})`).join(', '))
  const dup = await c.query(`
    select to_char(min_at, 'YYYY-MM') m, count(*) filter (where n > 1) dup, count(*) total,
           count(*) filter (where n > 1 and has_mobile) dup_mobile
      from (select user_id, count(*) n, min(created_at) min_at, bool_or(meta->>'via' = 'mobile') has_mobile
              from user_activity_log where event = 'registered' group by user_id) t
     group by 1 order by 1 desc limit 4`)
  console.table(dup.rows)
  await c.end()
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
