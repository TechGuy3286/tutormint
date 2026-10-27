/**
 * scripts/apply-migration-207.ts — applies supabase/migrations/207_contact_withdraw.sql.
 * One transaction; without --apply it rolls back.
 *
 * Checks (no real row is changed; the insert probe uses an invented hash inside
 * a rolled-back savepoint):
 *   - the migration runs twice cleanly (re-runnable);
 *   - do_not_use_numbers / contact_withdrawals: RLS on, no policies, and
 *     nothing readable as anon or as a signed-in token;
 *   - a second live row with the same hash is refused; a removed one is not;
 *   - sync_parent_tuitions() skips hidden_reason 'contact_withdrawn';
 *   - job and hidden-tuition counts unchanged.
 * Prints counts and true/false only.
 *
 *   npx tsx --env-file=.env.local scripts/apply-migration-207.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/207_contact_withdraw.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  await c.query(`set local lock_timeout = '5s'`)
  const check = (label: string, ok: boolean) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
    if (!ok) throw new Error(`check failed: ${label}`)
  }
  try {
    const before = (await c.query(`select (select count(*) from jobs)::int j, (select count(*) from jobs where status='hidden')::int hj`)).rows[0]
    await c.query(sql)
    await c.query(sql)
    console.log('migration ran twice cleanly')

    for (const t of ['do_not_use_numbers', 'contact_withdrawals']) {
      const r = (await c.query(`select relrowsecurity rls, (select count(*)::int from pg_policies where schemaname='public' and tablename=$1) pol from pg_class where relname=$1 and relnamespace='public'::regnamespace`, [t])).rows[0]
      check(`${t}: RLS on, no policies`, r.rls === true && r.pol === 0)
      for (const role of ['anon', 'authenticated']) {
        await c.query('savepoint r')
        let rows = -1
        try {
          await c.query(`set local role ${role}`)
          rows = (await c.query(`select count(*)::int n from public.${t}`)).rows[0].n
        } catch {
          rows = 0 // refused outright: as good as nothing readable
        }
        await c.query('rollback to savepoint r')
        check(`${t}: nothing readable as ${role}`, rows === 0)
      }
    }

    const h = 'f'.repeat(64)
    await c.query('savepoint s')
    await c.query(`insert into do_not_use_numbers (number_hash, masked, reason) values ($1, '0300 •••• 000', 'probe reason')`, [h])
    let dup = false
    try {
      await c.query('savepoint d')
      await c.query(`insert into do_not_use_numbers (number_hash, masked, reason) values ($1, '0300 •••• 000', 'probe reason')`, [h])
    } catch {
      dup = true
      await c.query('rollback to savepoint d')
    }
    check('a second live row with the same hash is refused', dup)
    await c.query(`update do_not_use_numbers set removed_at = now() where number_hash = $1`, [h])
    await c.query(`insert into do_not_use_numbers (number_hash, masked, reason) values ($1, '0300 •••• 000', 'probe reason')`, [h])
    console.log('a removed row allows a new live row')
    await c.query('rollback to savepoint s')

    const body = (await c.query(`select prosrc from pg_proc where proname='sync_parent_tuitions' and pronamespace='public'::regnamespace`)).rows[0].prosrc as string
    check('sync_parent_tuitions skips contact_withdrawn (both branches)', (body.match(/contact_withdrawn/g) ?? []).length === 2)

    const after = (await c.query(`select (select count(*) from jobs)::int j, (select count(*) from jobs where status='hidden')::int hj`)).rows[0]
    check('job counts unchanged', before.j === after.j && before.hj === after.hj)

    if (apply) {
      await c.query('commit')
      console.log('APPLIED')
    } else {
      await c.query('rollback')
      console.log('dry run — rolled back')
    }
  } catch (e) {
    await c.query('rollback').catch(() => {})
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  } finally {
    await c.end()
  }
}
main()
