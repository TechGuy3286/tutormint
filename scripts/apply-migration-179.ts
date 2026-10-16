/**
 * scripts/apply-migration-179.ts — applies supabase/migrations/179_target_counting_start.sql
 * (staff_target_months, staff-read RLS, October 2026 counting from 15 Oct). One
 * transaction; without --apply it rolls back. Runs the file twice (idempotent)
 * and checks that no existing row or policy changed.
 *   npx tsx --env-file=.env.local scripts/apply-migration-179.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

type Row = Record<string, string>

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/179_target_counting_start.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const fp = async () =>
    (
      await c.query(
        `select (select md5(string_agg(staff_id::text || month || target::text, ',' order by staff_id, month)) from staff_monthly_targets) as targets,
                (select md5(string_agg(staff_id::text || on_list::text, ',' order by staff_id)) from staff_target_list) as list,
                (select md5(string_agg(tablename || policyname || cmd || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname))
                   from pg_policies where schemaname in ('public','storage') and tablename <> 'staff_target_months') as policies`,
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
    const months = await c.query(`select month, counting_starts::text as start from staff_target_months order by month`)
    console.log('counting starts:', months.rows.map((r: Row) => `${r.month} → ${r.start}`).join(', '))
    const oct = months.rows.find((r: Row) => r.month === '2026-10')
    if (!oct || oct.start !== '2026-10-15') throw new Error('October 2026 should count from 2026-10-15')
    const rls = await c.query(`select relname, relrowsecurity from pg_class where relname = 'staff_target_months'`)
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
