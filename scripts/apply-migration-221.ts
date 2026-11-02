/**
 * scripts/apply-migration-221.ts — applies supabase/migrations/221_rank_tutors_page_first.sql.
 *
 * One transaction; without --apply it rolls back. Before swapping the function
 * it records the OLD rank_tutors() output for a spread of argument sets (no
 * filter, a city, a subject, a query, page 2 by offset, page 2 by cursor), then
 * applies the file (twice) and requires the NEW output to be identical — same
 * rows, same order, same columns. Then times the unfiltered call as anon.
 * Prints ids/counts/timings only.
 *
 *   npx tsx --env-file=.env.local scripts/apply-migration-221.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/221_rank_tutors_page_first.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 })
  await c.connect()
  await c.query('begin')
  await c.query(`set local lock_timeout = '5s'`)
  try {
    const { rows: m } = await c.query(`select master_id from tutor_subjects group by master_id order by count(*) desc limit 3`)
    const ids = m.map((r: { master_id: number }) => r.master_id)
    const today = `'2026-11-02'::date`
    const sets = [
      `p_limit=>12, p_offset=>0, p_today=>${today}`,
      `p_limit=>12, p_offset=>12, p_today=>${today}`,
      `p_limit=>50, p_offset=>0, p_today=>${today}`,
      `p_limit=>12, p_offset=>0, p_city=>'Lahore', p_today=>${today}`,
      `p_limit=>12, p_offset=>0, p_city=>'Karachi', p_area=>'DHA', p_today=>${today}`,
      `p_limit=>12, p_offset=>0, p_master_ids=>array[${ids.join(',')}]::int[], p_today=>${today}`,
      `p_limit=>12, p_offset=>0, p_query=>'ali', p_today=>${today}`,
      `p_limit=>12, p_offset=>0, p_teaching_mode=>'Online Tutor', p_gender=>'female', p_today=>${today}`,
      `p_limit=>700, p_offset=>0, p_today=>${today}`,
    ]
    const run = async (args: string) => (await c.query(`select * from rank_tutors(${args})`)).rows
    const before = []
    for (const s of sets) before.push(await run(s))
    // A cursor taken from the 12th row of the first page.
    const r12 = before[0][11]
    const cursor = r12
      ? `p_limit=>12, p_today=>${today}, p_after_tier=>${r12.tier}, p_after_loc=>${r12.location_score}, p_after_score=>${Number(r12.score).toFixed(2)}, p_after_hash=>'${r12.sort_hash}', p_after_completion=>${r12.completion}`
      : null
    const beforeCursor = cursor ? await run(cursor) : []

    await c.query(sql)
    await c.query(sql)

    for (let i = 0; i < sets.length; i++) {
      const after = await run(sets[i])
      assert.deepEqual(after, before[i], `set ${i} differs`)
      console.log(`set ${i}: ${after.length} rows identical (total ${after[0]?.total_count ?? 0})`)
    }
    if (cursor) {
      assert.deepEqual(await run(cursor), beforeCursor, 'cursor page differs')
      console.log(`cursor page: ${beforeCursor.length} rows identical`)
    }

    await c.query('savepoint t')
    await c.query('set local role anon')
    for (const s of [sets[0], sets[3], sets[0], sets[0], sets[5], sets[0]]) {
      const t = Date.now()
      await c.query(`select count(*) from rank_tutors(${s})`)
      console.log(`anon timing ${Date.now() - t} ms  (${s.split(',')[2] ?? ''})`)
    }
    await c.query('rollback to savepoint t')

    const { rows: g } = await c.query(
      `select has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u from pg_proc p where proname = 'rank_tutors'`,
    )
    assert.ok(g[0].a && g[0].u, 'grants kept')
    console.log('grants kept: anon + authenticated may execute')

    await c.query(apply ? 'commit' : 'rollback')
    console.log(apply ? 'APPLIED' : 'dry run — rolled back')
  } catch (e) {
    await c.query('rollback').catch(() => {})
    console.error('FAILED, rolled back:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  } finally {
    await c.end()
  }
}

main()
