/**
 * scripts/dataop-mark-hub-notices.ts (owner, 16 Oct 2026)
 *
 * The Indexing API is for single tuition pages only. Every WAITING notice for
 * any other address (area / city hubs queued by the Locations approvals) is
 * MARKED — never deleted: skipped_at = now, skip_reason = 'not_tuition',
 * sent_at = the "never send" marker, last_error = "Not sent — not a tuition
 * page". One admin_audit_log summary row. Without --apply nothing is written.
 *
 *   npx tsx --env-file=.env.local scripts/dataop-mark-hub-notices.ts [--apply]
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

import { isTuitionPageUrl, SKIP_NOTE, SUPERSEDED_AT } from '../lib/googleIndexingCore'

const OWNER_EMAIL = 'techguy3286@gmail.com'

async function main() {
  const apply = process.argv.includes('--apply')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const waiting = (await c.query(`select id, url, kind, created_at from indexing_queue where sent_at is null order by id`)).rows as {
    id: number
    url: string
    kind: string
  }[]
  const hub = waiting.filter((r) => !isTuitionPageUrl(r.url))
  console.log(`waiting before: ${waiting.length} (${hub.length} not a tuition page, ${new Set(hub.map((r) => r.url)).size} distinct addresses)`)
  for (const u of [...new Set(hub.map((r) => r.url))].slice(0, 50)) console.log('  ', u)
  if (!apply || hub.length === 0) {
    console.log(apply ? 'nothing to mark' : 'dry run — nothing written')
    await c.end()
    return
  }
  const owner = (await c.query(`select id from profiles where email = $1`, [OWNER_EMAIL])).rows[0]?.id as string | undefined
  await c.query('begin')
  try {
    const ids = hub.map((r) => r.id)
    const upd = await c.query(
      `update indexing_queue set skipped_at = now(), skip_reason = 'not_tuition', sent_at = $2, last_error = $3
        where id = any($1::bigint[]) and sent_at is null`,
      [ids, SUPERSEDED_AT, SKIP_NOTE.not_tuition],
    )
    await c.query(
      `insert into admin_audit_log (actor_id, actor_role, actor_email, action, target_type, target_id, detail)
       values ($1, 'owner', $2, 'indexing.skip_not_tuition', 'indexing_queue', null, $3::jsonb)`,
      [owner ?? null, 'system: indexing clean-up', JSON.stringify({ marked: upd.rowCount, ids, addresses: [...new Set(hub.map((r) => r.url))] })],
    )
    await c.query('commit')
    const left = (await c.query(`select count(*)::int n from indexing_queue where sent_at is null`)).rows[0].n
    console.log(`marked ${upd.rowCount}; waiting after: ${left}`)
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
