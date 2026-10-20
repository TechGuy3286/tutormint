/**
 * scripts/apply-migration-189.ts — applies supabase/migrations/189_checkout_paid_another_way.sql.
 * One transaction; without --apply it rolls back. Runs the file twice
 * (idempotent), checks no payment row changed, the CHECK refuses an unknown reason and accepts paid_another_way.
 *   npx tsx --env-file=.env.local scripts/apply-migration-189.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/189_checkout_paid_another_way.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('begin')
  try {
    const fp = `select count(*)::int n, md5(string_agg(id::text || status || coalesce(plan_code,'') || amount_pkr::text, ',' order by id)) h from payments`
    const before = (await c.query(fp)).rows[0]
    await c.query(sql)
    await c.query(sql)
    const after = (await c.query(fp)).rows[0]
    if (before.n !== after.n || before.h !== after.h) throw new Error('a payment row changed')
    const any = (await c.query(`select id from payments limit 1`)).rows[0]?.id
    let refused = false
    if (any) {
      await c.query('savepoint s')
      try {
        await c.query(`update payments set checkout_close_reason = 'nonsense' where id = $1`, [any])
      } catch {
        refused = true
      }
      await c.query('rollback to savepoint s')
      if (!refused) throw new Error('CHECK did not refuse')
      await c.query('savepoint t')
      await c.query(`update payments set checkout_close_reason = 'paid_another_way' where id = $1`, [any])
      await c.query('rollback to savepoint t')
    }
    console.log(`payments ${after.n}, unchanged; unknown reason refused: ${refused}`)
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
