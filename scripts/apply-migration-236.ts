/**
 * scripts/apply-migration-236.ts — applies supabase/migrations/236_cnic_address_and_forward_alerts.sql.
 * One transaction; without --apply it rolls back. Proves: the two new tables keep
 * RLS on with no policy and no client grant and start empty; the new columns
 * exist; no profiles address, user_documents or applications row changed.
 * Counts and yes/no only — never a name, phone, email or address.
 *   npx tsx --env-file=.env.local scripts/apply-migration-236.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const n = async (c: pg.Client, sql: string) => Number((await c.query(sql)).rows[0].n)

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/236_cnic_address_and_forward_alerts.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 })
  await c.connect()
  await c.query('begin')
  try {
    const addrHash = `select md5(coalesce(string_agg(id::text || coalesce(address,'') || coalesce(address_status,''), ',' order by id), '')) h, count(*)::int n from profiles`
    const docHash = `select md5(coalesce(string_agg(id::text || coalesce(status,'') || coalesce(cnic_read_status,''), ',' order by id), '')) h, count(*)::int n from user_documents`
    const appHash = `select md5(coalesce(string_agg(id::text || coalesce(stage,''), ',' order by id), '')) h, count(*)::int n from applications`
    const before = [(await c.query(addrHash)).rows[0], (await c.query(docHash)).rows[0], (await c.query(appHash)).rows[0]]
    await c.query(sql)
    await c.query(sql) // re-runnable

    for (const [t, col] of [['user_documents', 'address_read_at'], ['whatsapp_update_sends', 'forwarded_application_ids']]) {
      const ok = (await c.query(`select 1 from information_schema.columns where table_schema = 'public' and table_name = '${t}' and column_name = '${col}'`)).rows.length
      assert.equal(ok, 1, `${t}.${col} exists`)
    }
    for (const t of ['address_suggestions', 'application_forward_alerts']) {
      const rls = (await c.query(`select relrowsecurity r from pg_class where relname = '${t}' and relnamespace = 'public'::regnamespace`)).rows[0]?.r
      assert.equal(rls, true, `${t} RLS on`)
      assert.equal(await n(c, `select count(*)::int n from pg_policies where tablename = '${t}'`), 0, `${t} no policy`)
      assert.equal(await n(c, `select count(*)::int n from information_schema.role_table_grants where table_name = '${t}' and grantee in ('anon','authenticated')`), 0, `${t} no client grant`)
      assert.equal(await n(c, `select count(*)::int n from ${t}`), 0, `${t} starts empty`)
    }
    assert.equal(await n(c, `select count(*)::int n from user_documents where address_read_at is not null`), 0, 'no document marked read')

    const after = [(await c.query(addrHash)).rows[0], (await c.query(docHash)).rows[0], (await c.query(appHash)).rows[0]]
    assert.equal(after[0].h, before[0].h, 'profiles addresses unchanged')
    assert.equal(after[1].h, before[1].h, 'user_documents unchanged')
    assert.equal(after[2].h, before[2].h, 'applications unchanged')
    console.log(`checks passed: 2 service-role-only tables, 2 columns; ${before[0].n} profiles, ${before[1].n} documents, ${before[2].n} applications unchanged`)
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
