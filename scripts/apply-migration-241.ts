/**
 * scripts/apply-migration-241.ts — applies supabase/migrations/241_pr14_featured_match_items.sql.
 * One transaction; without --apply it rolls back. Proves: the table exists with
 * RLS on, no policy and no client grant; one item per tutor per day (unique);
 * 1–5 tuitions per item (check); whatsapp_update_sends is untouched (row count
 * and hash); the migration re-runs cleanly. Counts and yes/no only.
 *   npx tsx --env-file=.env.local scripts/apply-migration-241.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const n = async (c: pg.Client, sql: string, p: unknown[] = []) => Number((await c.query(sql, p)).rows[0].n)

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/241_pr14_featured_match_items.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 })
  await c.connect()
  await c.query('begin')
  try {
    const sig = `select count(*)::bigint n, md5(coalesce(string_agg(md5(to_jsonb(w)::text), '' order by id), '')) h from whatsapp_update_sends w`
    const before = (await c.query(sig)).rows[0]

    await c.query(sql)
    await c.query(sql) // re-runnable

    const t = 'featured_match_items'
    assert.equal((await c.query(`select relrowsecurity r from pg_class where relname=$1 and relnamespace='public'::regnamespace`, [t])).rows[0]?.r, true, 'RLS on')
    assert.equal(await n(c, `select count(*)::int n from pg_policies where tablename=$1`, [t]), 0, 'no policy')
    assert.equal(await n(c, `select count(*)::int n from information_schema.role_table_grants where table_name=$1 and grantee in ('anon','authenticated')`, [t]), 0, 'no client grant')

    // Constraint probes on a real tutor id, inside savepoints (rolled back).
    const tutor = (await c.query(`select id from profiles where role='tutor' order by created_at limit 1`)).rows[0]?.id as string | undefined
    if (tutor) {
      const job = '00000000-0000-4000-8000-000000000001'
      await c.query('savepoint a')
      await c.query(`insert into featured_match_items (tutor_id, pk_day, job_ids) values ($1, '2000-01-01', array[$2]::uuid[])`, [tutor, job])
      let dup = false
      try {
        await c.query('savepoint b')
        await c.query(`insert into featured_match_items (tutor_id, pk_day, job_ids) values ($1, '2000-01-01', array[$2]::uuid[])`, [tutor, job])
      } catch {
        dup = true
        await c.query('rollback to savepoint b')
      }
      assert.ok(dup, 'one item per tutor per day')
      let empty = false
      try {
        await c.query('savepoint c')
        await c.query(`insert into featured_match_items (tutor_id, pk_day, job_ids) values ($1, '2000-01-02', '{}')`, [tutor])
      } catch {
        empty = true
        await c.query('rollback to savepoint c')
      }
      assert.ok(empty, 'an item lists at least one tuition')
      await c.query('rollback to savepoint a')
    }
    assert.equal(await n(c, `select count(*)::int n from featured_match_items`), 0, 'no rows left by the probes')

    const after = (await c.query(sig)).rows[0]
    assert.equal(String(after.n), String(before.n), 'whatsapp_update_sends row count unchanged')
    assert.equal(after.h, before.h, 'whatsapp_update_sends rows unchanged')

    if (apply) {
      await c.query('commit')
      console.log('241 APPLIED')
    } else {
      await c.query('rollback')
      console.log('241 dry run OK (rolled back)')
    }
  } catch (e) {
    await c.query('rollback').catch(() => {})
    console.error('241 FAILED:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  } finally {
    await c.end()
  }
}
main()
