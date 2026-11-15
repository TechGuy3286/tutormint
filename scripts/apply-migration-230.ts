/**
 * scripts/apply-migration-230.ts — applies supabase/migrations/230_selfie_optional.sql.
 * One transaction; without --apply it rolls back. Proves the change only ADDS
 * (directory, sitemap and "Verified first" counts never fall), keeps the view's
 * options and every grant, and that rank_tutors is still plpgsql +
 * force_custom_plan. Prints counts and yes/no only — never a name or id.
 *   npx tsx --env-file=.env.local scripts/apply-migration-230.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const n = async (c: pg.Client, sql: string) => Number((await c.query(sql)).rows[0].n)

async function snapshot(c: pg.Client) {
  return {
    directory: await n(c, `select count(*)::int n from tutor_directory`),
    sitemap: await n(c, `select count(*)::int n from listed_tutor_slugs()`),
    verifiedFirst: await n(c, `select count(*) filter (where verified_ok)::int n from rank_tutors(p_limit => 100000)`),
    ranked: await n(c, `select count(*)::int n from rank_tutors(p_limit => 100000)`),
    opts: String((await c.query(`select coalesce(array_to_string(reloptions, ','), '') o from pg_class where oid = 'public.tutor_directory'::regclass`)).rows[0].o),
    grants: String(
      (await c.query(`select string_agg(grantee || ':' || privilege_type, ',' order by grantee, privilege_type) g from information_schema.role_table_grants where table_schema = 'public' and table_name = 'tutor_directory'`)).rows[0].g,
    ),
    fnGrants: String(
      (await c.query(`select string_agg(p.proname || ':' || has_function_privilege('anon', p.oid, 'execute') || has_function_privilege('authenticated', p.oid, 'execute'), ',' order by p.proname) g from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('rank_tutors', 'listed_tutor_slugs')`)).rows[0].g,
    ),
  }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/230_selfie_optional.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 })
  await c.connect()
  await c.query('begin')
  try {
    const before = await snapshot(c)
    const rowsBefore = await n(c, `select count(*)::int n from profiles where selfie_status is not null`)
    await c.query(sql)
    await c.query(sql) // re-runnable
    const after = await snapshot(c)
    console.log('directory', before.directory, '->', after.directory)
    console.log('sitemap tutors', before.sitemap, '->', after.sitemap)
    console.log('Verified-first tier', before.verifiedFirst, '->', after.verifiedFirst)
    assert.ok(after.directory >= before.directory, 'directory never shrinks')
    assert.ok(after.sitemap >= before.sitemap, 'sitemap never shrinks')
    assert.ok(after.verifiedFirst >= before.verifiedFirst, 'Verified-first tier never shrinks')
    assert.equal(after.opts, before.opts, 'view options kept')
    assert.equal(after.grants, before.grants, 'view grants kept')
    assert.equal(after.fnGrants, before.fnGrants, 'function grants kept')
    assert.equal(await n(c, `select count(*)::int n from profiles where selfie_status is not null`), rowsBefore, 'no row changed')
    const fn = (await c.query(`select l.lanname, array_to_string(p.proconfig, ',') cfg from pg_proc p join pg_language l on l.oid = p.prolang where p.proname = 'rank_tutors'`)).rows[0]
    assert.equal(fn.lanname, 'plpgsql', 'rank_tutors stays plpgsql')
    assert.ok(String(fn.cfg).includes('plan_cache_mode=force_custom_plan'), 'force_custom_plan kept')
    console.log('options, grants, plpgsql + force_custom_plan kept: yes')

    await c.query('savepoint t')
    await c.query('set local role anon')
    for (let i = 0; i < 4; i++) {
      const t = Date.now()
      await c.query(`select count(*) from rank_tutors()`)
      console.log(`anon rank_tutors ${Date.now() - t} ms`)
    }
    await c.query('rollback to savepoint t')

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
