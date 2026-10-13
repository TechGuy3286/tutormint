/**
 * scripts/apply-migration-171.ts — applies
 * supabase/migrations/171_post_cover_prompt.sql (one new nullable column,
 * posts.cover_prompt; no existing row changes, no policy changes).
 * One transaction; without --apply it rolls back.
 *   npx tsx --env-file=.env.local scripts/apply-migration-171.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/171_post_cover_prompt.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const fingerprint = async () =>
    (
      await c.query(
        `select count(*)::int as n, md5(string_agg(id::text || coalesce(cover_path, '') || coalesce(cover_alt, '') || status || updated_at::text, '|' order by id)) as fp from posts`,
      )
    ).rows[0] as { n: number; fp: string }
  const policies = async () =>
    (await c.query(`select count(*)::int as n, md5(string_agg(tablename || policyname || cmd || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname)) as fp from pg_policies where schemaname in ('public', 'storage')`)).rows[0] as { n: number; fp: string }
  const before = await fingerprint()
  const polBefore = await policies()
  await c.query('begin')
  try {
    await c.query(sql)
    const after = await fingerprint()
    const polAfter = await policies()
    const col = await c.query(`select data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'posts' and column_name = 'cover_prompt'`)
    const filled = await c.query(`select count(*)::int as n from posts where cover_prompt is not null`)
    console.log('posts rows before/after:', before.n, after.n, '· existing columns unchanged:', before.fp === after.fp)
    console.log('policies before/after:', polBefore.n, polAfter.n, '· unchanged:', polBefore.fp === polAfter.fp)
    console.log('cover_prompt column:', JSON.stringify(col.rows[0]), '· rows with a prompt:', filled.rows[0].n)
    if (before.fp !== after.fp || before.n !== after.n) throw new Error('an existing post changed')
    if (polBefore.fp !== polAfter.fp) throw new Error('a policy changed')
    await c.query(apply ? 'commit' : 'rollback')
    console.log(apply ? 'COMMITTED' : 'DRY RUN — rolled back')
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
