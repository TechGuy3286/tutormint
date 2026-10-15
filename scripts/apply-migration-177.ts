/**
 * scripts/apply-migration-177.ts — applies supabase/migrations/177_staff_monthly_targets.sql
 * (two tables, staff-read RLS, the seeded target list). One transaction;
 * without --apply it rolls back. Runs the file twice (idempotent) and checks
 * that no existing row or policy changed.
 *   npx tsx --env-file=.env.local scripts/apply-migration-177.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

type Row = Record<string, string>

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/177_staff_monthly_targets.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const fp = async () =>
    (
      await c.query(
        `select (select md5(string_agg(id::text || coalesce(admin_role,'') || coalesce(full_name,''), ',' order by id)) from profiles) as profiles,
                (select md5(string_agg(member_id::text || staff_id::text, ',' order by member_id)) from staff_signup_credits) as credits,
                (select md5(string_agg(id::text || status::text, ',' order by id)) from payments) as payments,
                (select md5(string_agg(tablename || policyname || cmd || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname))
                   from pg_policies where schemaname in ('public','storage') and tablename not in ('staff_monthly_targets','staff_target_list')) as policies`,
      )
    ).rows[0] as Row
  const before = await fp()
  await c.query('begin')
  try {
    await c.query(sql)
    await c.query(sql)
    const after = await fp()
    for (const k of Object.keys(before)) {
      console.log(`${k} unchanged:`, before[k] === after[k])
      if (before[k] !== after[k]) throw new Error(`${k} changed`)
    }
    const list = await c.query(
      `select p.full_name, l.on_list from staff_target_list l join profiles p on p.id = l.staff_id order by p.full_name`,
    )
    console.log('target list:', list.rows.map((r: Row) => `${r.full_name}${r.on_list ? '' : ' (off)'}`).join(', '))
    if (list.rows.length !== 4) throw new Error(`expected 4 on the target list, found ${list.rows.length}`)
    const targets = await c.query(`select count(*) n from staff_monthly_targets`)
    console.log('targets seeded:', targets.rows[0].n)
    const rls = await c.query(
      `select relname, relrowsecurity from pg_class where relname in ('staff_monthly_targets','staff_target_list') order by 1`,
    )
    console.log('rls:', rls.rows.map((r: { relname: string; relrowsecurity: boolean }) => `${r.relname}=${r.relrowsecurity}`).join(', '))
    await c.query(apply ? 'commit' : 'rollback')
    console.log(apply ? 'APPLIED' : 'dry run — rolled back')
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
