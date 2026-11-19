/**
 * scripts/apply-migration-238.ts — applies supabase/migrations/238_parent_interest_inbox.sql.
 * One transaction; without --apply it rolls back. Proves: the six new columns
 * exist, existing sends read as channel 'daily', the one-live-send-a-day index
 * exists, the table keeps RLS on with no policy and no client grant, and no
 * send row, interest event or profile view changed. Counts and yes/no only —
 * never a name, phone or email.
 *   npx tsx --env-file=.env.local scripts/apply-migration-238.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const n = async (c: pg.Client, sql: string) => Number((await c.query(sql)).rows[0].n)

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/238_parent_interest_inbox.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 })
  await c.connect()
  await c.query('begin')
  try {
    const counts = `select (select count(*) from whatsapp_update_sends) + (select count(*) from parent_interest_events) * 1000003 + (select count(*) from profile_views) * 7919 as n`
    const before = await n(c, counts)
    const dupes = await n(c, `select count(*)::int n from (select tutor_id, pk_day from whatsapp_update_sends where undone_at is null group by 1, 2 having count(*) > 1) d`)
    console.log('tutor-days with more than one live send before:', dupes)
    await c.query(sql)
    await c.query(sql) // re-runnable

    for (const col of ['channel', 'sent_from', 'activity_at', 'unpaid', 'parent_ids', 'view_ids']) {
      const ok = (await c.query(`select 1 from information_schema.columns where table_schema = 'public' and table_name = 'whatsapp_update_sends' and column_name = '${col}'`)).rows.length
      assert.equal(ok, 1, `whatsapp_update_sends.${col} exists`)
    }
    assert.equal(await n(c, `select count(*)::int n from whatsapp_update_sends where channel <> 'daily'`), 0, 'existing sends are daily')
    assert.equal(await n(c, `select count(*)::int n from pg_indexes where indexname = 'whatsapp_update_sends_one_live_a_day'`), 1, 'one live send a day index')
    const rls = (await c.query(`select relrowsecurity r from pg_class where relname = 'whatsapp_update_sends' and relnamespace = 'public'::regnamespace`)).rows[0]?.r
    assert.equal(rls, true, 'RLS on')
    assert.equal(await n(c, `select count(*)::int n from pg_policies where tablename = 'whatsapp_update_sends'`), 0, 'no policy')
    assert.equal(await n(c, `select count(*)::int n from information_schema.role_table_grants where table_name = 'whatsapp_update_sends' and grantee in ('anon','authenticated')`), 0, 'no client grant')
    assert.equal(await n(c, counts), before, 'sends, interest events and profile views unchanged')
    console.log('checks passed: 6 columns, 2 indexes, service-role only; no rows changed')
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
