/**
 * scripts/apply-migration-217.ts — applies supabase/migrations/217_social_links_follow_up.sql.
 * One transaction; without --apply it rolls back. First reads the LIVE check
 * constraint and refuses if it allows anything the new list drops. Runs the
 * file twice (re-runnable), then checks every existing row still passes and a
 * 'social_links' row is accepted (inserted and removed inside the rolled-back
 * savepoint). Prints counts only.
 *
 *   npx tsx --env-file=.env.local scripts/apply-migration-217.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const NEW = ['stuck', 'unpaid', 'abandoned', 'documents', 'status_image', 'parents', 'social_links']

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/217_social_links_follow_up.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  await c.query(`set local lock_timeout = '5s'`)
  try {
    const def = (await c.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'member_follow_ups_source_check'`)).rows[0]?.d as string
    const live = [...(def ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    const dropped = live.filter((v) => !NEW.includes(v))
    console.log('live values:', live.length, '· dropped by new list:', dropped.length)
    if (dropped.length) throw new Error(`new list would drop: ${dropped.join(', ')}`)
    const before = (await c.query(`select count(*)::int n from member_follow_ups`)).rows[0].n
    await c.query(sql)
    await c.query(sql)
    const after = (await c.query(`select count(*)::int n from member_follow_ups`)).rows[0].n
    await c.query('savepoint probe')
    const any = (await c.query(`select member_id, staff_id from member_follow_ups where staff_id is not null limit 1`)).rows[0]
    if (any) {
      await c.query(
        `insert into member_follow_ups (member_id, channel, template_key, source, staff_id) values ($1, 'whatsapp', 'social_links', 'social_links', $2)`,
        [any.member_id, any.staff_id],
      )
      console.log('a social_links follow-up is accepted')
    }
    await c.query('rollback to savepoint probe')
    console.log('rows before/after:', before, after)
    if (before !== after) throw new Error('row count changed')
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
