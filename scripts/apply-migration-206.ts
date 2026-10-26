/**
 * scripts/apply-migration-206.ts — applies supabase/migrations/206_manager_sees_staff_signups.sql.
 * One transaction; without --apply it rolls back.
 *
 * Checks (as each staff token, inside savepoints that are rolled back):
 *   - a Manager ('supervisor') reads every staff_signup_credits row after the
 *     change (before: only their own);
 *   - an Operations / Tuitions staff token still reads only its own rows.
 * Prints counts only.
 *
 *   npx tsx --env-file=.env.local scripts/apply-migration-206.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/206_manager_sees_staff_signups.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await c.connect()
  await c.query('begin')
  await c.query(`set local lock_timeout = '5s'`)
  try {
    const total = (await c.query(`select count(*)::int n from staff_signup_credits`)).rows[0].n as number
    const staff = (await c.query(`
      select id, admin_role from profiles
       where role = 'admin' and admin_role in ('supervisor','operations','tuitions_staff')
         and not coalesce(is_suspended,false)`)).rows as { id: string; admin_role: string }[]
    const seen = async (id: string) => {
      await c.query('savepoint p')
      try {
        await c.query(`set local role authenticated`)
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id, role: 'authenticated' })])
        return (await c.query(`select count(*)::int n from staff_signup_credits`)).rows[0].n as number
      } finally {
        await c.query('rollback to savepoint p')
      }
    }
    const before = new Map<string, number>()
    for (const s of staff) before.set(s.id, await seen(s.id))
    await c.query(sql)
    await c.query(sql)
    console.log(`staff_signup_credits rows: ${total}`)
    for (const s of staff) {
      const after = await seen(s.id)
      console.log(`${s.admin_role}: before ${before.get(s.id)} → after ${after}`)
      if (s.admin_role === 'supervisor' && after !== total) throw new Error('Manager does not see every row')
      if (s.admin_role !== 'supervisor' && after !== before.get(s.id)) throw new Error(`${s.admin_role} rows changed`)
    }
    if (apply) {
      await c.query('commit')
      console.log('APPLIED')
    } else {
      await c.query('rollback')
      console.log('DRY RUN — rolled back')
    }
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    await c.end()
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
