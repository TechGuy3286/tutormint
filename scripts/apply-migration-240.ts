/**
 * scripts/apply-migration-240.ts — applies supabase/migrations/240_pr12_insights_fee_notice_paypro_end.sql.
 * One transaction; without --apply it rolls back. Proves: payments gained
 * non_refundable_ack_at and no payment row changed; the PayPro cut-off is
 * 2026-11-19; 'staff.all_rows' holds exactly one id that is a Backend Support
 * account; the two insight tables exist with RLS on, no policy and no client
 * grant; bump_insight_visit works (inside the transaction, then rolled back /
 * removed) and refuses a non-hash visitor; activity_sessions gained device/os
 * and no session row changed; the migration re-runs cleanly. Counts and yes/no
 * only — never a name, phone, CNIC or email.
 *   npx tsx --env-file=.env.local scripts/apply-migration-240.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const n = async (c: pg.Client, sql: string, p: unknown[] = []) => Number((await c.query(sql, p)).rows[0].n)

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/240_pr12_insights_fee_notice_paypro_end.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 })
  await c.connect()
  await c.query('begin')
  try {
    const paySig = `select md5(string_agg(md5(to_jsonb(p)::text), '' order by id)) h from payments p`
    const sesSig = `select count(*)::bigint n from activity_sessions`
    const payBefore = (await c.query(paySig)).rows[0].h
    const sesBefore = await n(c, sesSig)

    await c.query(sql)
    await c.query(sql) // re-runnable

    assert.equal(await n(c, `select count(*)::int n from information_schema.columns where table_name='payments' and column_name='non_refundable_ack_at'`), 1, 'payments.non_refundable_ack_at')
    const paySigAfter = `select md5(string_agg(md5((to_jsonb(p) - 'non_refundable_ack_at')::text), '' order by id)) h from payments p`
    assert.equal((await c.query(paySigAfter)).rows[0].h, payBefore, 'no payment row changed')
    assert.equal((await c.query(`select value from app_settings where key='pay.paypro.cutoff'`)).rows[0].value, '2026-11-19', 'cut-off moved')
    const grant = JSON.parse((await c.query(`select value from app_settings where key='staff.all_rows'`)).rows[0].value) as string[]
    assert.equal(grant.length, 1, 'one granted account')
    assert.equal(await n(c, `select count(*)::int n from profiles where id = $1 and admin_role = 'backend_support'`, [grant[0]]), 1, 'the granted account is Backend Support')

    for (const t of ['insight_visitor_days', 'insight_hour_counts']) {
      assert.equal((await c.query(`select relrowsecurity r from pg_class where relname=$1 and relnamespace='public'::regnamespace`, [t])).rows[0]?.r, true, `${t}: RLS on`)
      assert.equal(await n(c, `select count(*)::int n from pg_policies where tablename=$1`, [t]), 0, `${t}: no policy`)
      assert.equal(await n(c, `select count(*)::int n from information_schema.role_table_grants where table_name=$1 and grantee in ('anon','authenticated')`, [t]), 0, `${t}: no client grant`)
    }
    assert.equal(await n(c, `select count(*)::int n from information_schema.routine_privileges where routine_name='bump_insight_visit' and grantee in ('anon','authenticated','PUBLIC')`), 0, 'bump_insight_visit: no client execute')

    await c.query('savepoint s1')
    await c.query(`select public.bump_insight_visit('0123456789abcdef', 'mobile', 'android')`)
    await c.query(`select public.bump_insight_visit('0123456789abcdef', 'mobile', 'android')`)
    assert.equal(await n(c, `select views::int n from insight_visitor_days where visitor='0123456789abcdef'`), 2, 'one row per visitor-day, views counted')
    assert.ok((await n(c, `select coalesce(sum(count),0)::int n from insight_hour_counts`)) >= 2, 'hour counted')
    await c.query('rollback to savepoint s1')
    await c.query('savepoint s2')
    let refused = false
    try {
      await c.query(`select public.bump_insight_visit('203.0.113.7', 'mobile', 'android')`)
    } catch {
      refused = true
    }
    await c.query('rollback to savepoint s2')
    assert.ok(refused, 'an IP-looking value is refused as a visitor')
    assert.equal(await n(c, `select count(*)::int n from insight_visitor_days`), 0, 'visitor table empty after the test')

    assert.equal(await n(c, `select count(*)::int n from information_schema.columns where table_name='activity_sessions' and column_name in ('device','os')`), 2, 'activity_sessions.device/os')
    assert.equal(await n(c, sesSig), sesBefore, 'no session row added or removed')

    if (apply) {
      await c.query('commit')
      console.log('APPLIED 240')
    } else {
      await c.query('rollback')
      console.log('DRY RUN 240 — all checks passed, rolled back')
    }
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
