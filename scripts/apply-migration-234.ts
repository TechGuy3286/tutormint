/**
 * scripts/apply-migration-234.ts — applies supabase/migrations/234_statement_auto_link_undo.sql.
 * One transaction; without --apply it rolls back. Proves: the two columns exist,
 * bank_statement_rows keeps RLS on with no permissive policy and no client
 * grant, and no row changed. Counts and yes/no only.
 *   npx tsx --env-file=.env.local scripts/apply-migration-234.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const n = async (c: pg.Client, sql: string) => Number((await c.query(sql)).rows[0].n)

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/234_statement_auto_link_undo.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  try {
    const hash = `select md5(coalesce(string_agg(id::text || coalesce(transfer_id::text,'') || coalesce(match_kind,''), ',' order by id), '')) h, count(*)::int n from bank_statement_rows`
    const before = (await c.query(hash)).rows[0]
    await c.query(sql)
    await c.query(sql) // re-runnable
    for (const col of ['auto_link_undone_at', 'auto_link_undone_by']) {
      assert.equal(await n(c, `select count(*)::int n from information_schema.columns where table_name = 'bank_statement_rows' and column_name = '${col}'`), 1, col)
    }
    const rls = (await c.query(`select relrowsecurity r from pg_class where relname = 'bank_statement_rows' and relnamespace = 'public'::regnamespace`)).rows[0]?.r
    assert.equal(rls, true, 'RLS on')
    assert.equal(await n(c, `select count(*)::int n from pg_policies where tablename = 'bank_statement_rows' and permissive = 'PERMISSIVE'`), 0, 'no permissive policy')
    assert.equal(await n(c, `select count(*)::int n from information_schema.role_table_grants where table_name = 'bank_statement_rows' and grantee in ('anon','authenticated')`), 0, 'no client grant')
    const after = (await c.query(hash)).rows[0]
    assert.equal(after.h, before.h, 'rows unchanged')
    console.log(`checks passed: 2 columns added, owner-only kept, ${before.n} rows unchanged`)
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
