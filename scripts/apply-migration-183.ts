/**
 * scripts/apply-migration-183.ts — applies supabase/migrations/183_email_sends.sql.
 * One transaction; without --apply it rolls back. Runs the file twice
 * (idempotent), then proves the policies: an ordinary member's token sees no
 * row, the service role (this session) can write.
 *   npx tsx --env-file=.env.local scripts/apply-migration-183.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/183_email_sends.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('begin')
  try {
    await c.query(sql)
    await c.query(sql)
    const run = '00000000-0000-4000-8000-000000000183'
    await c.query(`insert into email_runs (id, job) values ($1, 'migration-proof')`, [run])
    await c.query(`insert into email_sends (mode, job, recipient, status, attempts, run_id) values ('bulk','migration-proof','a@example.com','sent',1,$1)`, [run])
    const member = (await c.query(`select id from profiles where role in ('tutor','parent') limit 1`)).rows[0]?.id as string
    await c.query('savepoint m')
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: member, role: 'authenticated' })])
    await c.query('set local role authenticated')
    const seen = (await c.query('select (select count(*) from email_sends)::int s, (select count(*) from email_runs)::int r')).rows[0]
    let refused = false
    try {
      await c.query(`insert into email_sends (mode, job, recipient, status) values ('one','x','b@example.com','sent')`)
    } catch {
      refused = true
    }
    await c.query('rollback to savepoint m')
    console.log(`member sees ${seen.s} sends, ${seen.r} runs; member insert refused: ${refused}`)
    if (seen.s !== 0 || seen.r !== 0 || !refused) throw new Error('policy wrong')
    await c.query(`delete from email_runs where id = $1`, [run])
    await c.query(apply ? 'commit' : 'rollback')
    console.log(apply ? 'APPLIED' : 'dry run — rolled back')
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
