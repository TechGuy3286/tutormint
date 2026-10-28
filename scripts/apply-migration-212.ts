/**
 * scripts/apply-migration-212.ts — applies supabase/migrations/212_template_review.sql.
 * One transaction; without --apply it rolls back. Runs the file twice (it is
 * re-runnable), then checks the result. Prints counts only.
 *
 *   npx tsx --env-file=.env.local scripts/apply-migration-212.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/212_template_review.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  await c.query(`set local lock_timeout = '5s'`)
  const one = async (q: string) => (await c.query(q)).rows[0]
  try {
    const before = (await one(`select count(*)::int n, md5(string_agg(key || body, '|' order by key)) h from admin_message_templates`))
    await c.query(sql)
    await c.query(sql)
    const checks: Record<string, number> = {}
    for (const t of ['template_reviews', 'template_history', 'email_wordings']) {
      checks[t + 'Rls'] = (await one(`select count(*)::int n from pg_tables where schemaname='public' and tablename='${t}' and rowsecurity`)).n
      checks[t + 'Policies'] = (await one(`select count(*)::int n from pg_policies where tablename='${t}'`)).n
      checks[t + 'Rows'] = (await one(`select count(*)::int n from public.${t}`)).n
    }
    const after = (await one(`select count(*)::int n, md5(string_agg(key || body, '|' order by key)) h from admin_message_templates`))
    console.log('after (ran twice):', JSON.stringify(checks), 'templates unchanged:', before.n === after.n && before.h === after.h)
    for (const t of ['template_reviews', 'template_history', 'email_wordings']) {
      if (checks[t + 'Rls'] !== 1 || checks[t + 'Policies'] !== 1) throw new Error(`${t}: RLS or policy wrong`)
    }
    if (before.h !== after.h) throw new Error('live templates changed')
    if (apply) {
      await c.query('commit')
      console.log('APPLIED')
    } else {
      await c.query('rollback')
      console.log('DRY RUN — rolled back')
    }
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
