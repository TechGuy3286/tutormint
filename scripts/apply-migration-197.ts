/**
 * scripts/apply-migration-197.ts — applies supabase/migrations/197_fee_reply_template.sql.
 * One transaction; without --apply it rolls back. Runs the file twice
 * (idempotent) and checks:
 *   - no other template row changed;
 *   - fu_fee_reply holds exactly the code default (FU_FEE_REPLY_DEFAULT).
 *   npx tsx --env-file=.env.local scripts/apply-migration-197.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { FU_FEE_REPLY_DEFAULT, FU_FEE_REPLY_KEY } from '../lib/followUpTemplatesCore'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/197_fee_reply_template.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('begin')
  try {
    const fp = `select md5(string_agg(key || title || coalesce(subject,'') || body, ',' order by key)) m
                  from admin_message_templates where key <> $1`
    const before = (await c.query(fp, [FU_FEE_REPLY_KEY])).rows[0].m
    const existed = (await c.query(`select 1 from admin_message_templates where key = $1`, [FU_FEE_REPLY_KEY])).rowCount
    await c.query(sql)
    await c.query(sql)
    const after = (await c.query(fp, [FU_FEE_REPLY_KEY])).rows[0].m
    if (before !== after) throw new Error('another template changed')
    console.log('templates: no other template changed')
    const row = (await c.query(`select title, body from admin_message_templates where key = $1`, [FU_FEE_REPLY_KEY])).rows[0]
    if (!row) throw new Error('fu_fee_reply was not inserted')
    if (!existed && row.body !== FU_FEE_REPLY_DEFAULT) throw new Error('fu_fee_reply body differs from the code default')
    console.log(`fu_fee_reply: ${existed ? 'already there, left as it was' : 'inserted, byte-for-byte the code default'} (“${row.title}”)`)
    if (apply) {
      await c.query('commit')
      console.log('APPLIED')
    } else {
      await c.query('rollback')
      console.log('dry run — rolled back')
    }
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    await c.end()
  }
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
