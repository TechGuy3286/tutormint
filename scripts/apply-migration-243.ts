/**
 * scripts/apply-migration-243.ts — applies supabase/migrations/243_pr17_rank_cache.sql.
 * One transaction; without --apply it rolls back. Proves, for a spread of
 * argument sets: rank_tutors() (cache path) returns exactly the rows, columns
 * and order of rank_tutors_live() (the previous body); a stale cache falls back
 * to the live body; landing_combinations_fast() equals the view; the
 * migration re-runs cleanly; prints timings (before = live, after = cache).
 * Counts and timings only — no name, phone or email is printed.
 *   npx tsx --env-file=.env.local scripts/apply-migration-243.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const ARGS: string[] = [
  `p_limit => 24`,
  `p_limit => 24, p_offset => 24`,
  `p_limit => 500`,
  `p_city => 'Lahore', p_limit => 24`,
  `p_city => 'lahore', p_limit => 300`,
  `p_city => 'Karachi', p_limit => 24`,
  `p_city => 'Islamabad', p_gender => 'female', p_limit => 24`,
  `p_city => 'Lahore', p_master_ids => (select array_agg(id) from taxonomy_master where subject_slug = 'english'), p_limit => 24`,
  `p_city => 'Lahore', p_master_ids => (select array_agg(id) from taxonomy_master where subject_slug in ('math','mathematics')), p_limit => 100`,
  `p_master_id => (select master_id from tutor_subjects group by 1 order by count(*) desc limit 1), p_limit => 24`,
  `p_teaching_mode => 'online', p_limit => 24`,
  `p_city => 'Lahore', p_area => 'DHA', p_limit => 24`,
  `p_city => 'Lahore', p_area => 'Johar Town', p_master_ids => (select array_agg(id) from taxonomy_master where subject_slug = 'english'), p_limit => 24`,
  `p_city => 'Karachi', p_area => 'Gulshan-e-Iqbal', p_limit => 24, p_offset => 24`,
  `p_query => 'ali', p_limit => 24`,
  `p_fee_min => 5000, p_fee_max => 20000, p_limit => 24`,
]

async function sameRows(c: pg.Client, args: string): Promise<{ n: number }> {
  const q = (fn: string) => `select row_to_json(t)::text j, ord from ${fn}(${args}) with ordinality t(id, slug, full_name, headline, avatar_url, city, area, areas, teaching_mode, job_types, gender, hourly_rate_pkr, fee_min_pkr, fee_max_pkr, experience_years, rating_avg, rating_count, subject_labels, level_labels, plan_code, tier, location_score, score, sort_hash, total_count, completion, has_degree, cities, fee_paid, verified_ok, ord)`
  const a = (await c.query(q('rank_tutors'))).rows.map((r: { j: string }) => r.j)
  const b = (await c.query(q('rank_tutors_live'))).rows.map((r: { j: string }) => r.j)
  assert.deepEqual(a, b, `cache == live for (${args})`)
  return { n: a.length }
}

async function time(c: pg.Client, sql: string, runs = 7): Promise<{ median: number; p95: number }> {
  const t: number[] = []
  for (let i = 0; i < runs; i++) {
    const r = await c.query(`explain (analyze, timing off, summary on) ${sql}`)
    const line = r.rows.map((x: Record<string, string>) => x['QUERY PLAN']).find((l: string) => l.startsWith('Execution Time'))
    t.push(Number(String(line).replace(/[^0-9.]/g, '')))
  }
  t.sort((x, y) => x - y)
  return { median: t[Math.floor(t.length / 2)], p95: t[Math.min(t.length - 1, Math.ceil(t.length * 0.95) - 1)] }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/243_pr17_rank_cache.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 })
  await c.connect()
  await c.query('begin')
  try {
    await c.query(`set local lock_timeout = '10s'`)
    // BEFORE: the live body as it is in production now.
    const before: Record<string, { median: number; p95: number }> = {}
    for (const a of ARGS) before[a] = await time(c, `select * from rank_tutors(${a})`, 5)

    const t0 = performance.now()
    await c.query(sql)
    console.log(`migration ran in ${(performance.now() - t0).toFixed(0)} ms`)
    await c.query(sql) // re-runnable
    const st = (await c.query(`select tutors, changed, ms from tutor_rank_cache_state where id = 1`)).rows[0]
    console.log('cache state', st)
    const dir = Number((await c.query(`select count(*) n from tutor_directory`)).rows[0].n)
    assert.equal(Number(st.tutors), dir, 'one cache row per listed tutor')
    // A second full refresh with nothing changed writes nothing.
    const again = Number((await c.query(`select refresh_tutor_rank_cache(null) n`)).rows[0].n)
    assert.equal(again, 0, 'an idle refresh changes no row')
    // A targeted refresh works and changes nothing either.
    const one = (await c.query(`select id from tutor_rank_cache limit 1`)).rows[0].id
    assert.equal(Number((await c.query(`select refresh_tutor_rank_cache(array[$1::uuid]) n`, [one])).rows[0].n), 0, 'targeted idle refresh')

    for (const a of ARGS) {
      const { n } = await sameRows(c, a)
      const after = await time(c, `select * from rank_tutors(${a})`, 7)
      console.log(`${a.slice(0, 70).padEnd(70)} rows=${String(n).padStart(3)}  before median=${before[a].median.toFixed(0)}ms p95=${before[a].p95.toFixed(0)}ms  after median=${after.median.toFixed(1)}ms p95=${after.p95.toFixed(1)}ms`)
    }
    // Simple fallback answers fast and only with listed tutors.
    const simple = await time(c, `select * from rank_tutors_simple('Lahore', null, null, null, 24, 0)`, 5)
    console.log(`rank_tutors_simple median=${simple.median.toFixed(1)}ms`)
    const bad = Number((await c.query(`select count(*) n from rank_tutors_simple(null, null, null, null, 2000, 0) s where s.id not in (select id from tutor_directory)`)).rows[0].n)
    assert.equal(bad, 0, 'fallback lists only directory tutors')

    // Landing counts equal the view.
    const diff = Number((await c.query(`select count(*) n from ((select kind, city, master_id, n from landing_combinations_fast() except select kind, city, master_id, n from landing_combinations where master_id is not null) union all (select kind, city, master_id, n from landing_combinations where master_id is not null except select kind, city, master_id, n from landing_combinations_fast())) x`)).rows[0].n)
    assert.equal(diff, 0, 'stored landing counts == view')
    const lv = await time(c, `select * from landing_combinations order by kind, city, master_id`, 3)
    const lf = await time(c, `select * from landing_combinations_fast() order by kind, city, master_id`, 5)
    console.log(`landing view median=${lv.median.toFixed(0)}ms  stored median=${lf.median.toFixed(1)}ms`)

    // Stale cache -> the live body answers (same rows).
    await c.query(`update tutor_rank_cache_state set full_at = now() - interval '11 minutes' where id = 1`)
    await sameRows(c, `p_city => 'Lahore', p_limit => 24`)
    await c.query(`update tutor_rank_cache_state set full_at = now() where id = 1`)

    // Anon cannot read the new tables; can call the functions.
    for (const t of ['tutor_rank_cache', 'tutor_rank_cache_state', 'landing_combination_counts']) {
      const r = (await c.query(`select has_table_privilege('anon', 'public.${t}', 'select') a`)).rows[0].a
      assert.equal(r, false, `anon has no select on ${t}`)
    }
    const fx = (await c.query(`select has_function_privilege('anon', 'public.refresh_tutor_rank_cache(uuid[])', 'execute') a, has_function_privilege('anon', 'public.rank_tutors_live(integer, text, text, text, text, integer, integer, text, integer, integer, date, integer, integer, numeric, text, integer, integer[])', 'execute') b, has_function_privilege('anon', 'public.rank_tutors(integer, text, text, text, text, integer, integer, text, integer, integer, date, integer, integer, numeric, text, integer, integer[])', 'execute') c2`)).rows[0]
    assert.equal(fx.a, false, 'anon cannot refresh')
    assert.equal(fx.b, false, 'anon cannot call the live body directly')
    assert.equal(fx.c2, true, 'anon still calls rank_tutors')
    const cfg = (await c.query(`select proconfig from pg_proc where proname = 'rank_tutors'`)).rows[0].proconfig as string[]
    assert.ok(cfg.some((x) => x === 'plan_cache_mode=force_custom_plan'), 'rank_tutors keeps force_custom_plan')
    const lang = (await c.query(`select l.lanname from pg_proc p join pg_language l on l.oid = p.prolang where p.proname = 'rank_tutors'`)).rows[0].lanname
    assert.equal(lang, 'plpgsql', 'rank_tutors stays plpgsql')

    await c.query(apply ? 'commit' : 'rollback')
    console.log(apply ? 'APPLIED 243 — all checks passed' : 'DRY RUN 243 (rolled back) — all checks passed')
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
