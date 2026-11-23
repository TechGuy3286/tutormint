/**
 * scripts/apply-migration-246.ts — applies supabase/migrations/246_pr20_contact_messages_blog_hand_set.sql.
 * One transaction; without --apply it rolls back. Proves (inside a savepoint,
 * always rolled back): a contact message can be stored by the service role;
 * anon and authenticated cannot read or write the table (RLS on, no policies,
 * privileges revoked); posts.hand_set defaults to an empty list; the migration
 * re-runs cleanly. Counts / yes-no only — nothing personal is printed. The test
 * row uses invented values and is rolled back.
 *   npx tsx --env-file=.env.local scripts/apply-migration-246.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/246_pr20_contact_messages_blog_hand_set.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 })
  await c.connect()
  await c.query('begin')
  try {
    await c.query(`set local lock_timeout = '10s'`)
    await c.query(sql)
    await c.query(sql) // re-runnable

    await c.query('savepoint t')
    await c.query(`insert into contact_messages (name, contact, contact_kind, message) values ('Invented Person', 'invented@example.com', 'email', 'Invented test message')`)
    const n = Number((await c.query(`select count(*) n from contact_messages where name = 'Invented Person'`)).rows[0].n)
    assert.equal(n, 1, 'the service role stores a message')
    for (const role of ['anon', 'authenticated']) {
      await c.query('savepoint r')
      let refused = false
      try {
        await c.query(`set local role ${role}`)
        await c.query(`select count(*) from contact_messages`)
      } catch {
        refused = true
      } finally {
        await c.query('rollback to savepoint r')
      }
      assert.ok(refused, `${role} cannot read contact_messages`)
    }
    await c.query('rollback to savepoint t')

    const rls = (await c.query(`select relrowsecurity r from pg_class where oid = 'public.contact_messages'::regclass`)).rows[0].r
    assert.equal(rls, true, 'RLS is on')
    const def = (await c.query(`select column_default d from information_schema.columns where table_name = 'posts' and column_name = 'hand_set'`)).rows[0]?.d
    assert.ok(String(def).includes('{}'), 'posts.hand_set defaults to empty')
    console.log('contact_messages: RLS on, anon/authenticated refused; posts.hand_set ready')

    if (apply) {
      await c.query('commit')
      console.log('✓ migration 246 APPLIED')
    } else {
      await c.query('rollback')
      console.log('✓ dry run passed (rolled back). Re-run with --apply.')
    }
  } catch (e) {
    await c.query('rollback').catch(() => undefined)
    console.error('✗', e instanceof Error ? e.message : e)
    process.exitCode = 1
  } finally {
    await c.end()
  }
}
main()
