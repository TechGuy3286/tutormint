/**
 * scripts/apply-migration-235.ts — applies supabase/migrations/235_tutor_teasers.sql.
 * One transaction; without --apply it rolls back. Proves: the column exists with
 * default true and NOT NULL, both new tables keep RLS on with no policy and no
 * client grant, and no existing tutor_profiles / applications row changed apart
 * from the new column. Counts and yes/no only — never a name, phone or email.
 *   npx tsx --env-file=.env.local scripts/apply-migration-235.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const n = async (c: pg.Client, sql: string) => Number((await c.query(sql)).rows[0].n)

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/235_tutor_teasers.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 })
  await c.connect()
  await c.query('begin')
  try {
    const tpHash = `select md5(coalesce(string_agg(id::text || coalesce(updated_at::text,''), ',' order by id), '')) h, count(*)::int n from tutor_profiles`
    const appHash = `select md5(coalesce(string_agg(id::text || coalesce(stage,''), ',' order by id), '')) h, count(*)::int n from applications`
    const tpBefore = (await c.query(tpHash)).rows[0]
    const appBefore = (await c.query(appHash)).rows[0]
    await c.query(sql)
    await c.query(sql) // re-runnable

    const col = (await c.query(`select is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = 'tutor_profiles' and column_name = 'whatsapp_updates'`)).rows[0]
    assert.ok(col, 'whatsapp_updates exists')
    assert.equal(col.is_nullable, 'NO', 'not null')
    assert.equal(String(col.column_default), 'true', 'default true')
    assert.equal(await n(c, `select count(*)::int n from tutor_profiles where whatsapp_updates is not true`), 0, 'every tutor starts opted in')

    for (const t of ['application_parent_views', 'whatsapp_update_sends']) {
      const rls = (await c.query(`select relrowsecurity r from pg_class where relname = '${t}' and relnamespace = 'public'::regnamespace`)).rows[0]?.r
      assert.equal(rls, true, `${t} RLS on`)
      assert.equal(await n(c, `select count(*)::int n from pg_policies where tablename = '${t}'`), 0, `${t} no policy`)
      assert.equal(await n(c, `select count(*)::int n from information_schema.role_table_grants where table_name = '${t}' and grantee in ('anon','authenticated')`), 0, `${t} no client grant`)
      assert.equal(await n(c, `select count(*)::int n from ${t}`), 0, `${t} starts empty`)
    }

    const tpAfter = (await c.query(tpHash)).rows[0]
    const appAfter = (await c.query(appHash)).rows[0]
    assert.equal(tpAfter.h, tpBefore.h, 'tutor_profiles rows unchanged (other than the new column)')
    assert.equal(appAfter.h, appBefore.h, 'applications unchanged')
    console.log(`checks passed: column added (default on for ${tpBefore.n} tutors), 2 service-role-only tables, ${appBefore.n} applications unchanged`)
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
