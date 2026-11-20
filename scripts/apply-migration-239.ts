/**
 * scripts/apply-migration-239.ts — applies supabase/migrations/239_erase_fingerprints_and_crawl.sql.
 * One transaction; without --apply it rolls back. Proves: the two fingerprint
 * tables exist, RLS on, no policy, no client grant; tutor_profiles.content_updated_at
 * is filled for every row and updated_at did not move; a bookkeeping-only update
 * leaves content_updated_at alone while a headline change moves it (both inside
 * the transaction, on a row that is put back); listed_tutor_slugs() returns the
 * same slugs as before; the inbox index exists; no other row changed. Counts and
 * yes/no only — never a name, phone, CNIC or email.
 *   npx tsx --env-file=.env.local scripts/apply-migration-239.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const n = async (c: pg.Client, sql: string) => Number((await c.query(sql)).rows[0].n)

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/239_erase_fingerprints_and_crawl.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 })
  await c.connect()
  await c.query('begin')
  try {
    const triggers = (await c.query(`select tgname from pg_trigger where tgrelid = 'public.tutor_profiles'::regclass and not tgisinternal order by 1`)).rows.map((r: { tgname: string }) => r.tgname)
    console.log('tutor_profiles triggers before:', triggers.length)
    const updatedSig = `select coalesce(sum(extract(epoch from updated_at))::bigint, 0) as n from tutor_profiles`
    const beforeUpdated = await n(c, updatedSig)
    const slugsBefore = (await c.query(`select slug from listed_tutor_slugs() order by slug`)).rows.map((r: { slug: string }) => r.slug).join('|')
    const others = `select (select count(*) from profiles) + (select count(*) from tutor_profiles) * 7919 + (select count(*) from parent_interest_events) * 104729 as n`
    const beforeOthers = await n(c, others)
    const rowSig = `select md5(string_agg(md5((to_jsonb(t) - 'content_updated_at')::text), '' order by id)) as h from tutor_profiles t`
    const beforeRows = (await c.query(rowSig)).rows[0].h

    await c.query(sql)
    await c.query(sql) // re-runnable

    for (const t of ['erased_fingerprints', 'signup_block_attempts']) {
      const rls = (await c.query(`select relrowsecurity r from pg_class where relname = '${t}' and relnamespace = 'public'::regnamespace`)).rows[0]?.r
      assert.equal(rls, true, `${t}: RLS on`)
      assert.equal(await n(c, `select count(*)::int n from pg_policies where tablename = '${t}'`), 0, `${t}: no policy`)
      assert.equal(await n(c, `select count(*)::int n from information_schema.role_table_grants where table_name = '${t}' and grantee in ('anon','authenticated')`), 0, `${t}: no client grant`)
      assert.equal(await n(c, `select count(*)::int n from ${t}`), 0, `${t}: empty`)
    }
    // A plain number is refused as a fingerprint.
    await c.query('savepoint s1')
    let refused = false
    try {
      await c.query(`insert into erased_fingerprints (kind, fingerprint, member_id, erased_at) values ('mobile', '923001234567', gen_random_uuid(), now())`)
    } catch {
      refused = true
    }
    await c.query('rollback to savepoint s1')
    assert.ok(refused, 'a raw number cannot be stored as a fingerprint')

    assert.equal(await n(c, `select count(*)::int n from tutor_profiles where content_updated_at is null`), 0, 'content_updated_at filled')
    assert.equal(await n(c, updatedSig), beforeUpdated, 'updated_at did not move')
    assert.equal((await c.query(rowSig)).rows[0].h, beforeRows, 'no other tutor_profiles column changed')
    assert.equal(await n(c, `select count(*)::int n from tutor_profiles where content_updated_at is distinct from coalesce(updated_at, created_at)`), 0, 'start value = updated_at')

    // The trigger, on one row, put back by the rollback (or the savepoint).
    await c.query('savepoint s2')
    const one = (await c.query(`select id, content_updated_at from tutor_profiles order by id limit 1`)).rows[0]
    await c.query(`update tutor_profiles set status_card_dismissed_at = now() where id = $1`, [one.id])
    const afterBook = (await c.query(`select content_updated_at from tutor_profiles where id = $1`, [one.id])).rows[0].content_updated_at
    assert.equal(new Date(afterBook).getTime(), new Date(one.content_updated_at).getTime(), 'bookkeeping change keeps content_updated_at')
    await c.query(`update tutor_profiles set headline = coalesce(headline, '') || ' ' where id = $1`, [one.id])
    const afterReal = (await c.query(`select content_updated_at > $2::timestamptz as moved from tutor_profiles where id = $1`, [one.id, one.content_updated_at])).rows[0].moved
    assert.equal(afterReal, true, 'a headline change moves content_updated_at')
    await c.query('rollback to savepoint s2')

    const slugsAfter = (await c.query(`select slug from listed_tutor_slugs() order by slug`)).rows.map((r: { slug: string }) => r.slug).join('|')
    assert.equal(slugsAfter, slugsBefore, 'listed_tutor_slugs returns the same tutors')
    console.log('indexable tutors (sitemap):', slugsAfter ? slugsAfter.split('|').length : 0)
    assert.equal(await n(c, `select count(*)::int n from pg_indexes where indexname = 'parent_interest_events_created_idx'`), 1, 'inbox index')
    assert.equal(await n(c, others), beforeOthers, 'no rows added or removed')
    const trigAfter = (await c.query(`select count(*)::int n from pg_trigger where tgrelid = 'public.tutor_profiles'::regclass and not tgisinternal and tgenabled = 'D'`)).rows[0].n
    assert.equal(Number(trigAfter), 0, 'no tutor_profiles trigger left disabled')
    console.log('checks passed')
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
