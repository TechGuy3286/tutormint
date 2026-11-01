/**
 * scripts/apply-migration-218.ts — applies supabase/migrations/218_admin_summary_lists.sql.
 * One transaction; without --apply it rolls back. Runs the file twice
 * (re-runnable), then proves a signed-in (authenticated) token can neither read
 * nor write either table, inside a rolled-back savepoint. Prints results only.
 *
 *   npx tsx --env-file=.env.local scripts/apply-migration-218.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/218_admin_summary_lists.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  await c.query(`set local lock_timeout = '5s'`)
  try {
    await c.query(sql)
    await c.query(sql)
    for (const t of ['admin_summary', 'admin_list_rows']) {
      const r = (await c.query(`select relrowsecurity from pg_class where relname = $1 and relnamespace = 'public'::regnamespace`, [t])).rows[0]
      if (!r?.relrowsecurity) throw new Error(`${t}: RLS is not on`)
      const pol = (await c.query(`select count(*)::int n from pg_policies where schemaname='public' and tablename=$1`, [t])).rows[0].n
      if (pol !== 0) throw new Error(`${t}: expected no policies, found ${pol}`)
      for (const role of ['anon', 'authenticated']) {
        await c.query('savepoint probe')
        await c.query(`set local role ${role}`)
        let refused = false
        try {
          await c.query(`select 1 from public.${t} limit 1`)
        } catch {
          refused = true
        }
        await c.query('rollback to savepoint probe')
        if (!refused) throw new Error(`${t}: ${role} can read`)
      }
      console.log(`${t}: RLS on, no policies, anon and authenticated refused`)
    }
    if (apply) {
      await c.query('commit')
      console.log('APPLIED')
    } else {
      await c.query('rollback')
      console.log('DRY RUN — rolled back')
    }
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
