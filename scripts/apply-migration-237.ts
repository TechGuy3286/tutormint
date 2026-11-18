/**
 * scripts/apply-migration-237.ts — applies supabase/migrations/237_parent_interest.sql.
 * One transaction; without --apply it rolls back. Proves: the two new tables keep
 * RLS on with no policy and no client grant and start empty; the new column
 * exists; no shortlists, threads, demo_requests or notifications row changed.
 * Counts and yes/no only — never a name, phone or email.
 *   npx tsx --env-file=.env.local scripts/apply-migration-237.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const n = async (c: pg.Client, sql: string) => Number((await c.query(sql)).rows[0].n)

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/237_parent_interest.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 })
  await c.connect()
  await c.query('begin')
  try {
    const counts = `select (select count(*) from shortlists) + (select count(*) from threads) * 1000003 + (select count(*) from demo_requests) * 7919 + (select count(*) from notifications) * 31 as n`
    const before = await n(c, counts)
    await c.query(sql)
    await c.query(sql) // re-runnable

    const col = (await c.query(`select 1 from information_schema.columns where table_schema = 'public' and table_name = 'whatsapp_update_sends' and column_name = 'interest_event_ids'`)).rows.length
    assert.equal(col, 1, 'whatsapp_update_sends.interest_event_ids exists')
    for (const t of ['parent_interest_events', 'interest_holds']) {
      const rls = (await c.query(`select relrowsecurity r from pg_class where relname = '${t}' and relnamespace = 'public'::regnamespace`)).rows[0]?.r
      assert.equal(rls, true, `${t} RLS on`)
      assert.equal(await n(c, `select count(*)::int n from pg_policies where tablename = '${t}'`), 0, `${t} no policy`)
      assert.equal(await n(c, `select count(*)::int n from information_schema.role_table_grants where table_name = '${t}' and grantee in ('anon','authenticated')`), 0, `${t} no client grant`)
      assert.equal(await n(c, `select count(*)::int n from ${t}`), 0, `${t} starts empty`)
    }
    assert.equal(await n(c, counts), before, 'shortlists, threads, demo requests, notifications unchanged')
    console.log('checks passed: 2 service-role-only tables, 1 column; source tables unchanged')
    await c.query(apply ? 'commit' : 'rollback')
    console.log(apply ? 'APPLIED' : 'dry run — rolled back')
  } catch (e) {
    await c.query('rollback')
    console.error('FAILED, rolled back:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  } finally {
    await c.end()
  }
}

void main()
