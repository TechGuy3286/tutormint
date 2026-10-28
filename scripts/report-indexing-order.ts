/**
 * scripts/report-indexing-order.ts — read-only: the order the next Indexing API
 * drain would send waiting notices in (owner, 28 Oct 2026), first 10 URLs, and
 * how many waiting notices would be marked "not open".
 *   npx tsx --env-file=.env.local scripts/report-indexing-order.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { noticeSendable, planDrain, touchedAt, tuitionSlugOf, type NoticeFacts, type QueuedNotice } from '../lib/googleIndexingCore'
import { isPauseDue } from '../lib/tuitionStatus'
import { citySegment } from '../lib/slugs'

const SITE = 'https://www.tutormint.org'
async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const pending = (await c.query(`select id, url, kind, created_at::text, priority, next_attempt_at::text from indexing_queue where sent_at is null order by id`)).rows as QueuedNotice[]
  const jobs = (await c.query(`select public_slug, status, created_at::text, resumed_at::text, refreshed_at::text, bumped_at::text from jobs where public_slug is not null`)).rows
  const bySlug = new Map(jobs.map((j: { public_slug: string }) => [j.public_slug, j]))
  const facts = new Map<string, NoticeFacts>()
  const ok: QueuedNotice[] = []
  let notOpen = 0
  for (const n of pending) {
    const j = bySlug.get(tuitionSlugOf(n.url, SITE) ?? '') as { status: string; created_at: string; resumed_at: string | null } | undefined
    if (!j) continue
    const f: NoticeFacts = { status: j.status, touchedMs: touchedAt(j as never, n), expired: j.status === 'open' && isPauseDue(j.resumed_at ?? j.created_at) }
    if (noticeSendable(f) !== 'ok') { notOpen++; continue }
    facts.set(n.url, f); ok.push(n)
  }
  const plan = planDrain(ok, 0, 200, Date.now(), facts)
  console.log(`waiting: ${pending.length}, sendable: ${ok.length}, would be marked not open: ${notOpen}`)
  plan.send.slice(0, 10).forEach((n, i) => console.log(`${i + 1}. ${n.url}  (touched ${new Date(facts.get(n.url)!.touchedMs).toISOString().slice(0, 16)})`))
  if (plan.send.length === 0) {
    // Nothing waiting: the order the rule gives every open tuition, as if each had a notice.
    const all = (jobs as { public_slug: string; status: string; created_at: string; resumed_at: string | null }[]).filter((j) => j.status === 'open')
    const city = (await c.query("select public_slug, city from jobs where status='open'")).rows as { public_slug: string; city: string }[]
    const cityOf = new Map(city.map((r) => [r.public_slug, r.city]))
    const fake = all.map((j, i) => ({ id: i + 1, url: SITE + '/tuitions/' + citySegment(cityOf.get(j.public_slug) ?? null) + '/' + j.public_slug, kind: 'URL_UPDATED' as const, created_at: j.created_at, priority: 0 }))
    const f2 = new Map<string, NoticeFacts>()
    const keep = fake.filter((n, i) => { const j = all[i]; const f = { status: j.status, touchedMs: touchedAt(j as never), expired: isPauseDue(j.resumed_at ?? j.created_at) }; if (noticeSendable(f) !== 'ok') return false; f2.set(n.url, f); return true })
    const p2 = planDrain(keep, 0, 200, Date.now(), f2)
    const fresh = keep.filter((n) => Date.now() - f2.get(n.url)!.touchedMs <= 7 * 86400000).length
    console.log('open, unexpired: ' + keep.length + ', touched in the last 7 days: ' + fresh)
    p2.send.slice(0, 10).forEach((n, i) => console.log((i + 1) + '. ' + n.url))
  }
  await c.end()
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
