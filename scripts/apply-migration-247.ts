/**
 * scripts/apply-migration-247.ts — applies supabase/migrations/247_pr22_search_words_insights.sql.
 * One transaction; without --apply it rolls back. Proves (inside savepoints,
 * always rolled back): Windows / Mac are accepted device kinds; a search term
 * is counted by the service role (and a repeat adds to the same row); anon and
 * authenticated cannot read search_terms or search_term_actions; a 'mode'
 * Search word is accepted; anon_search_events.failed exists; the migration
 * re-runs cleanly. Counts / yes-no only — nothing personal is printed. Test
 * rows use invented values and are rolled back.
 *   npx tsx --env-file=.env.local scripts/apply-migration-247.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/247_pr22_search_words_insights.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 })
  await c.connect()
  await c.query('begin')
  try {
    await c.query(`set local lock_timeout = '10s'`)
    await c.query(sql)
    await c.query(sql) // re-runnable

    await c.query('savepoint t')
    await c.query(`insert into insight_visitor_days (day, visitor, device, os) values ('2000-01-01', 'aaaaaaaaaaaaaaaa', 'desktop', 'windows'), ('2000-01-01', 'bbbbbbbbbbbbbbbb', 'desktop', 'mac')`)
    await c.query(`select bump_search_term('tutors', 'invented term', 'Invented Term', true, false)`)
    await c.query(`select bump_search_term('tutors', 'invented term', 'Invented Term', false, true)`)
    const t = (await c.query(`select searches, zero, failed from search_terms where term_key = 'invented term'`)).rows[0]
    assert.deepEqual([t.searches, t.zero, t.failed], [2, 1, 1], 'one row per day: 2 searches, 1 zero, 1 failed')
    await c.query(`insert into taxonomy_aliases (kind, slug, alias) values ('mode', 'Online Tutor', 'invented-online-word')`)
    await c.query(`insert into search_term_actions (term_key, term, action, target_kind, target_slug, target_name) values ('invented term', 'Invented Term', 'demand', 'city', 'Lahore', 'Lahore')`)
    for (const role of ['anon', 'authenticated']) {
      for (const table of ['search_terms', 'search_term_actions']) {
        await c.query('savepoint r')
        let refused = false
        try {
          await c.query(`set local role ${role}`)
          await c.query(`select count(*) from ${table}`)
        } catch {
          refused = true
        } finally {
          await c.query('rollback to savepoint r')
        }
        assert.ok(refused, `${role} cannot read ${table}`)
      }
      await c.query('savepoint f')
      let refusedFn = false
      try {
        await c.query(`set local role ${role}`)
        await c.query(`select bump_search_term('tutors', 'x y', 'x y', false, false)`)
      } catch {
        refusedFn = true
      } finally {
        await c.query('rollback to savepoint f')
      }
      assert.ok(refusedFn, `${role} cannot call bump_search_term`)
    }
    await c.query('rollback to savepoint t')

    const col = (await c.query(`select count(*) n from information_schema.columns where table_name = 'anon_search_events' and column_name = 'failed'`)).rows[0].n
    assert.equal(Number(col), 1, 'anon_search_events.failed exists')
    for (const tb of ['search_terms', 'search_term_actions']) {
      const rls = (await c.query(`select relrowsecurity r from pg_class where oid = $1::regclass`, [`public.${tb}`])).rows[0].r
      assert.equal(rls, true, `${tb}: RLS on`)
    }
    console.log('devices: windows/mac accepted · search_terms counts per day, service role only · search_term_actions service role only · mode Search words · failed searches')

    if (apply) {
      await c.query('commit')
      console.log('✓ migration 247 APPLIED')
    } else {
      await c.query('rollback')
      console.log('✓ dry run passed (rolled back). Re-run with --apply.')
    }
  } catch (e) {
    await c.query('rollback').catch(() => undefined)
    console.error('✗', e instanceof Error ? e.message : 'failed')
    process.exitCode = 1
  } finally {
    await c.end()
  }
}
main()
