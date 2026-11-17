/**
 * scripts/apply-migration-233.ts — applies supabase/migrations/233_bank_statement_import.sql.
 * One transaction; without --apply it rolls back. Proves: the two statement
 * tables exist with RLS on and no permissive policy; anon and authenticated
 * hold no grant on them; bank_transfers accepts source 'statement' (probe in a
 * savepoint, rolled back) and still refuses an unknown source; payments gained
 * the Reopen / Undo columns; no existing row changed. Counts and yes/no only.
 *   npx tsx --env-file=.env.local scripts/apply-migration-233.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const n = async (c: pg.Client, sql: string) => Number((await c.query(sql)).rows[0].n)

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/233_bank_statement_import.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  try {
    const before = {
      transfers: await n(c, `select count(*)::int n from bank_transfers`),
      payments: await n(c, `select count(*)::int n from payments`),
      pay: String((await c.query(`select md5(string_agg(id::text || status || coalesce(reviewed_at::text,''), ',' order by id)) h from payments`)).rows[0].h),
    }
    await c.query(sql)
    await c.query(sql) // re-runnable
    for (const t of ['bank_statement_imports', 'bank_statement_rows']) {
      const rls = (await c.query(`select relrowsecurity r from pg_class where relname = $1 and relnamespace = 'public'::regnamespace`, [t])).rows[0]?.r
      assert.equal(rls, true, `${t} RLS on`)
      assert.equal(await n(c, `select count(*)::int n from pg_policies where tablename = '${t}' and permissive = 'PERMISSIVE'`), 0, `${t} no permissive policy`)
      assert.equal(await n(c, `select count(*)::int n from information_schema.role_table_grants where table_name = '${t}' and grantee in ('anon','authenticated')`), 0, `${t} no client grant`)
    }
    const def = String((await c.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'bank_transfers_source_check'`)).rows[0].d)
    assert.ok(def.includes('statement') && def.includes('email') && def.includes('manual'), 'source check')
    await c.query('savepoint p')
    await c.query(`insert into bank_transfers (transferred_on, amount_pkr, source, gateway) values ('2026-01-01', 1, 'statement', 'manual')`)
    await c.query('rollback to savepoint p')
    await c.query('savepoint q')
    let refused = false
    try {
      await c.query(`insert into bank_transfers (transferred_on, amount_pkr, source, gateway) values ('2026-01-01', 1, 'nonsense', 'manual')`)
    } catch {
      refused = true
    }
    await c.query('rollback to savepoint q')
    assert.ok(refused, 'unknown source refused')
    for (const col of ['reopened_at', 'reopen_reason', 'decision_undone_at']) {
      assert.equal(await n(c, `select count(*)::int n from information_schema.columns where table_name = 'payments' and column_name = '${col}'`), 1, col)
    }
    assert.equal(await n(c, `select count(*)::int n from bank_transfers`), before.transfers, 'bank_transfers unchanged')
    assert.equal(await n(c, `select count(*)::int n from payments`), before.payments, 'payments count unchanged')
    assert.equal(String((await c.query(`select md5(string_agg(id::text || status || coalesce(reviewed_at::text,''), ',' order by id)) h from payments`)).rows[0].h), before.pay, 'payments unchanged')
    console.log('checks passed: tables owner-only, source statement accepted (rolled back), unknown refused, payment columns added, no row changed')
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
