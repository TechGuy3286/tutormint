/**
 * scripts/dataop-queue-live-tuitions.ts — one-time (owner, 13 Oct 2026).
 *
 * A tuition now stays live 15 days (it was 7), so every tuition that is live
 * today has a later JobPosting validThrough. Nothing is stored for that — the
 * date is worked out from when the tuition was posted or last resumed — so no
 * tuition row is changed here. This only tells Google: it queues ONE
 * "URL_UPDATED" notice for each live, indexable tuition, NEWEST FIRST.
 *
 * It only ADDS rows to indexing_queue. Nothing is sent from here: the queue is
 * drained by the 5-minute cron, never more than 200 a day, so the notices go
 * out over several days. Already-paused tuitions are not touched and nothing is
 * reactivated. Safe to run twice: an address that already has a notice waiting
 * is skipped.
 *
 * Left out: a seed/test tuition (never indexable) and a tuition with no public
 * address.
 *
 *   npx tsx --env-file=.env.local scripts/dataop-queue-live-tuitions.ts
 *   npx tsx --env-file=.env.local scripts/dataop-queue-live-tuitions.ts --apply
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

import { citySegment } from '../lib/slugs'
import { LIVE_FLOOR_MS, TUITION_LIVE_DAYS, pauseDueAtMs } from '../lib/tuitionStatus'

const SITE = 'https://www.tutormint.org'
const DAY = 86_400_000

async function main() {
  const apply = process.argv.includes('--apply')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()

  const { rows } = (await c.query(
    `select j.id, j.ref_id, j.city, j.public_slug, j.created_at, j.resumed_at, coalesce(j.bumped_at, j.resumed_at, j.created_at) as bumped
       from jobs j
       join profiles p on p.id = j.parent_id
      where j.status = 'open'
        and j.public_slug is not null
        and j.merged_into is null
        and coalesce(p.is_test_name, false) = false
        and (coalesce(p.is_team_account, false) = true
             or (coalesce(p.is_seed, false) = false
                 and j.job_tx_id not ilike 'JOB-TRK%'
                 and j.job_tx_id not ilike 'SEED-JOB%'))
      order by coalesce(j.bumped_at, j.resumed_at, j.created_at) desc, j.id`,
  )) as { rows: { id: string; ref_id: string | null; city: string | null; public_slug: string; created_at: Date; resumed_at: Date | null }[] }

  const open = (await c.query(`select count(*)::int as n from jobs where status = 'open'`)).rows[0].n as number
  const now = Date.now()
  let extended = 0
  let floored = 0
  let soonest = Infinity
  for (const r of rows) {
    const base = (r.resumed_at ?? r.created_at).toISOString()
    const baseMs = new Date(base).getTime()
    const due = pauseDueAtMs(base)
    if (due > baseMs + 7 * DAY) extended++
    if (due === LIVE_FLOOR_MS && baseMs + TUITION_LIVE_DAYS * DAY < LIVE_FLOOR_MS) floored++
    soonest = Math.min(soonest, due)
  }

  const waiting = new Set(
    ((await c.query(`select url from indexing_queue where kind = 'URL_UPDATED' and sent_at is null`)).rows as { url: string }[]).map((r) => r.url),
  )
  const todo = rows.map((r) => ({ ...r, url: `${SITE}/tuitions/${citySegment(r.city)}/${r.public_slug}` })).filter((r) => !waiting.has(r.url))

  console.log(`live tuitions: ${open} · live and indexable: ${rows.length}`)
  console.log(`now live for ${TUITION_LIVE_DAYS} days instead of 7: ${extended}`)
  console.log(`of those, already past ${TUITION_LIVE_DAYS} days and given until ${new Date(LIVE_FLOOR_MS).toISOString()}: ${floored}`)
  if (rows.length) console.log(`the first of them now pauses on ${new Date(soonest).toISOString().slice(0, 10)} (in ${Math.max(0, Math.round((soonest - now) / DAY))} days)`)
  console.log(`already have a URL_UPDATED notice waiting: ${rows.length - todo.length}`)
  console.log(`to queue now: ${todo.length} (newest first${todo.length ? `: ${todo[0].ref_id} … ${todo[todo.length - 1].ref_id}` : ''})`)
  const queued = (await c.query(`select count(*)::int as n from indexing_queue where sent_at is null`)).rows[0].n as number
  console.log(`notices already waiting in the queue (all kinds): ${queued}`)
  console.log(`at 200 a day this takes about ${Math.max(1, Math.ceil(todo.length / 200))} day(s), longer on days with many new posts`)

  if (!apply) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to queue them.')
    await c.end()
    return
  }

  await c.query('begin')
  try {
    // One insert per row, in order, so the serial id keeps "newest first".
    for (const r of todo) await c.query(`insert into indexing_queue (url, kind) values ($1, 'URL_UPDATED')`, [r.url])
    await c.query('commit')
    console.log(`\nQUEUED ${todo.length} URL_UPDATED notices.`)
  } catch (e) {
    await c.query('rollback')
    console.error('FAILED — rolled back, nothing queued.', e)
    process.exitCode = 1
  }
  await c.end()
}

void main()
