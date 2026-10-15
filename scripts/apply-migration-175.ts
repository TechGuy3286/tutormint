/**
 * scripts/apply-migration-175.ts — applies supabase/migrations/175_staff_signups.sql
 * (four new tables + two template wordings). One transaction; without --apply
 * it rolls back. Runs the file twice to prove it is idempotent, and checks that
 * no existing profile, payment or job row and no existing policy changed.
 *   npx tsx --env-file=.env.local scripts/apply-migration-175.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/175_staff_signups.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const fp = async () =>
    (
      await c.query(
        `select (select md5(string_agg(id::text || coalesce(role::text,'') || coalesce(admin_role::text,''), ',' order by id)) from profiles) as profiles,
                (select md5(string_agg(id::text || status::text, ',' order by id)) from payments) as payments,
                (select md5(string_agg(id::text || status::text, ',' order by id)) from jobs) as jobs,
                (select md5(string_agg(tablename || policyname || cmd || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname))
                   from pg_policies where schemaname in ('public','storage') and tablename not like 'staff\\_%') as policies`,
      )
    ).rows[0] as Record<string, string>
  const before = await fp()
  const tplBefore = (await c.query(`select key, body from admin_message_templates where key in ('city_hiring_post','seeded_tuition_live') order by key`)).rows
  await c.query('begin')
  try {
    await c.query(sql)
    await c.query(sql) // idempotent: a second run must not fail
    const after = await fp()
    for (const k of Object.keys(before)) {
      console.log(`${k} unchanged:`, before[k] === after[k])
      if (before[k] !== after[k]) throw new Error(`${k} changed`)
    }
    const tables = await c.query(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('staff_join_links','staff_referral_visits','staff_signup_credits','staff_signup_claims') order by 1`,
    )
    console.log('tables:', JSON.stringify(tables.rows))
    const tplAfter = (await c.query(`select key, body from admin_message_templates where key in ('city_hiring_post','seeded_tuition_live') order by key`)).rows
    for (const t of tplAfter) {
      const was = tplBefore.find((x: { key: string }) => x.key === t.key)
      console.log(`template ${t.key}: ${was?.body === t.body ? 'unchanged (edited by staff or already updated)' : 'now has {join_link}'}`)
    }
    // A second pending claim for one account is refused.
    await c.query('savepoint s')
    const staff = (await c.query(`select id from profiles where role='admin' limit 1`)).rows[0]?.id
    if (staff) {
      const m = '00000000-0000-4000-8000-000000000175'
      await c.query(`insert into staff_signup_claims (member_id, staff_id, note) values ($1, $2, 'x')`, [m, staff])
      let refused = false
      try {
        await c.query(`insert into staff_signup_claims (member_id, staff_id, note) values ($1, $2, 'y')`, [m, staff])
      } catch {
        refused = true
      }
      console.log('second pending claim refused:', refused)
      if (!refused) throw new Error('one-pending index missing')
    }
    await c.query('rollback to savepoint s')
    await c.query(apply ? 'commit' : 'rollback')
    console.log(apply ? 'COMMITTED' : 'DRY RUN — rolled back')
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
