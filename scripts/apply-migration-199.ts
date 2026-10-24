/**
 * scripts/apply-migration-199.ts — applies supabase/migrations/199_cv_accent.sql.
 * One transaction; without --apply it rolls back. Runs the file twice
 * (idempotent) and checks:
 *   - the column exists and every existing row reads NULL (the default, navy);
 *   - the CHECK accepts navy / green / charcoal and NULL, and refuses anything else
 *     (proved inside a savepoint that is rolled back);
 *   - no other tutor_profiles column changed (row fingerprint before = after).
 * Prints counts only.
 *   npx tsx --env-file=.env.local scripts/apply-migration-199.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/199_cv_accent.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('begin')
  try {
    const fp = `select md5(string_agg((to_jsonb(t) - 'cv_accent')::text, ',' order by t.id)) m from tutor_profiles t`
    const before = (await c.query(fp)).rows[0].m
    await c.query(sql)
    await c.query(sql)
    const after = (await c.query(fp)).rows[0].m
    if (after !== before) throw new Error('a tutor_profiles row changed')
    const set = (await c.query(`select count(*)::int n from tutor_profiles where cv_accent is not null`)).rows[0].n
    if (set !== 0) throw new Error(`expected no accent set, found ${set}`)
    const any = (await c.query(`select id from tutor_profiles limit 1`)).rows[0]
    if (any) {
      await c.query('savepoint s')
      for (const v of ['navy', 'green', 'charcoal']) await c.query(`update tutor_profiles set cv_accent = $1 where id = $2`, [v, any.id])
      await c.query(`update tutor_profiles set cv_accent = null where id = $1`, [any.id])
      let refused = false
      try {
        await c.query(`update tutor_profiles set cv_accent = 'pink' where id = $1`, [any.id])
      } catch {
        refused = true
      }
      if (!refused) throw new Error('CHECK did not refuse an unknown colour')
      await c.query('rollback to savepoint s')
    }
    const rows = (await c.query(`select count(*)::int n from tutor_profiles`)).rows[0].n
    console.log(`tutor_profiles rows: ${rows}; cv_accent set on 0; CHECK ok`)
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
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
