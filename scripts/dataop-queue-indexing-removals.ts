/**
 * scripts/dataop-queue-indexing-removals.ts — one-time (owner, 12 Oct 2026).
 *
 * Until this change every tuition status change told Google "URL_UPDATED", even
 * a pause or a close. Google may therefore still hold paused and closed
 * tuitions as live jobs. This queues ONE "URL_DELETED" notice for each tuition
 * that is paused, closed or hired today — oldest first — so Google drops them.
 *
 * It only ADDS rows to indexing_queue. Nothing is sent from here: the queue is
 * drained by the 5-minute cron, never more than 200 a day, with new posts and
 * resumes ahead of these (lib/googleIndexingCore.planDrain). No tuition, member
 * or other row is changed, and nothing is deleted.
 *
 * Left out: a merged repeat (it was told to Google when it was merged and its
 * address redirects), a seed/test tuition (never indexable), a tuition with no
 * public address, and any address that already has a URL_DELETED notice.
 * Safe to run twice: the second run finds every address already queued.
 *
 *   npx tsx --env-file=.env.local scripts/dataop-queue-indexing-removals.ts
 *   npx tsx --env-file=.env.local scripts/dataop-queue-indexing-removals.ts --apply
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

import { citySegment } from '../lib/slugs'

const SITE = 'https://www.tutormint.org'

async function main() {
  const apply = process.argv.includes('--apply')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()

  const { rows } = (await c.query(
    `select j.id, j.ref_id, j.status, j.pause_source, j.city, j.public_slug, j.created_at
       from jobs j
       join profiles p on p.id = j.parent_id
      where j.status in ('paused', 'closed', 'hired')
        and j.public_slug is not null
        and j.merged_into is null
        and coalesce(p.is_test_name, false) = false
        and (coalesce(p.is_team_account, false) = true
             or (coalesce(p.is_seed, false) = false
                 and j.job_tx_id not ilike 'JOB-TRK%'
                 and j.job_tx_id not ilike 'SEED-JOB%'))
      order by j.created_at, j.id`,
  )) as { rows: { id: string; ref_id: string | null; status: string; pause_source: string | null; city: string | null; public_slug: string; created_at: Date }[] }

  const already = new Set(
    ((await c.query(`select url from indexing_queue where kind = 'URL_DELETED'`)).rows as { url: string }[]).map((r) => r.url),
  )
  const todo = rows
    .map((r) => ({ ...r, url: `${SITE}/tuitions/${citySegment(r.city)}/${r.public_slug}` }))
    .filter((r) => !already.has(r.url))

  const by = new Map<string, number>()
  for (const r of todo) {
    const k = r.status === 'paused' ? `paused (${r.pause_source ?? 'unknown'})` : r.status
    by.set(k, (by.get(k) ?? 0) + 1)
  }
  console.log(`paused / closed / hired tuitions with a public address: ${rows.length}`)
  console.log(`already have a URL_DELETED notice: ${rows.length - todo.length}`)
  console.log(`to queue now: ${todo.length}`)
  for (const [k, n] of by) console.log(`  ${k}: ${n}`)
  if (todo.length) console.log(`oldest: ${todo[0].ref_id} (${todo[0].created_at.toISOString().slice(0, 10)}) · newest: ${todo[todo.length - 1].ref_id}`)
  console.log(`at 200 a day this takes about ${Math.max(1, Math.ceil(todo.length / 200))} day(s), longer on days with many new posts`)

  if (!apply) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to queue them.')
    await c.end()
    return
  }

  await c.query('begin')
  try {
    // One insert per row, in order, so the serial id keeps "oldest first".
    for (const r of todo) await c.query(`insert into indexing_queue (url, kind) values ($1, 'URL_DELETED')`, [r.url])
    await c.query('commit')
    console.log(`\nQUEUED ${todo.length} URL_DELETED notices.`)
  } catch (e) {
    await c.query('rollback')
    console.error('FAILED — rolled back, nothing queued.', e)
    process.exitCode = 1
  }
  await c.end()
}

void main()
