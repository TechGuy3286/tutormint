/**
 * scripts/test-indexing-locations.ts (owner, 16 Oct 2026) — npm run test:indexinglocations
 *
 * Indexing only for tuition pages, the 60-day sitemap rule, and safer Locations
 * approvals. Pure rules plus source checks of the routes that enforce them.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { chunk, runBatches } from '../lib/batchRunCore'
import {
  isQuotaError,
  isTuitionPageUrl,
  newestFirst,
  pageCheckVerdict,
  planDrain,
  quotaReachedToday,
  SKIP_NOTE,
  tuitionSlugOf,
} from '../lib/googleIndexingCore'
import { iso, tuitionSitemapEntries } from '../lib/sitemapCore'

const src = (p: string) => readFileSync(p, 'utf8')
const BASE = 'https://www.tutormint.org'
const DAY = 86_400_000

test('only a single tuition page is a tuition page', () => {
  assert.equal(isTuitionPageUrl(`${BASE}/tuitions/lahore/home-tutor-required-grade-5-dha-a1b2c3`), true)
  for (const u of [
    `${BASE}/tuition-jobs/karachi/dha`,
    `${BASE}/tuition-jobs/lahore`,
    `${BASE}/tuitions/lahore/grade-4-mathematics`,
    `${BASE}/tutors/lahore/grade-4-mathematics`,
    `${BASE}/tutor/ali-sabeer-tutor`,
    `${BASE}/blog/how-to-become-a-tutor`,
    `${BASE}/about`,
    `${BASE}/tuitions/lahore/home-tutor-a1b2c3?x=1`,
    `https://tutormint.org/tuitions/lahore/home-tutor-a1b2c3`,
  ]) {
    assert.equal(isTuitionPageUrl(u), false, u)
  }
  assert.equal(tuitionSlugOf(`${BASE}/tuitions/lahore/home-tutor-a1b2c3`), 'home-tutor-a1b2c3')
})

test('a hub URL is never queued or sent', () => {
  const g = src('lib/googleIndexing.ts')
  // Both ways onto the queue refuse anything that is not a tuition page.
  const enqueue = g.slice(g.indexOf('export async function enqueueIndexing'))
  assert.match(enqueue.slice(0, 600), /isTuitionPageUrl/)
  const andDrain = g.slice(g.indexOf('async function enqueueAndDrain'))
  assert.match(andDrain.slice(0, 600), /isTuitionPageUrl/)
  // The drain marks waiting non-tuition notices instead of sending them.
  assert.match(g, /markSkipped\(admin, notTuition, 'not_tuition'\)/)
  assert.equal(SKIP_NOTE.not_tuition, 'Not sent — not a tuition page')
  // The Locations approvals no longer queue area hubs.
  const loc = src('lib/locationReview.ts')
  assert.doesNotMatch(loc, /enqueueIndexing\(/)
  assert.doesNotMatch(loc, /queueIndexing/)
})

test('a redirected or non-canonical URL is never sent', () => {
  const url = `${BASE}/tuitions/faislabad/home-tutor-a1b2c3`
  assert.equal(pageCheckVerdict(url, { status: 308, canonical: null }), 'old_address')
  assert.equal(pageCheckVerdict(url, { status: 301, canonical: null }), 'old_address')
  assert.equal(pageCheckVerdict(url, { status: 404, canonical: null }), 'old_address')
  assert.equal(pageCheckVerdict(url, { status: 200, canonical: `${BASE}/tuitions/faisalabad/home-tutor-a1b2c3` }), 'old_address')
  assert.equal(pageCheckVerdict(url, { status: 200, canonical: url }), 'send')
  assert.equal(pageCheckVerdict(url, null), 'transient')
  assert.equal(pageCheckVerdict(url, { status: 503, canonical: null }), 'transient')
  assert.equal(SKIP_NOTE.old_address, 'Not sent — old address')
  const g = src('lib/googleIndexing.ts')
  assert.match(g, /current\.get\(slug\) !== r\.url/)
  assert.match(g, /verdict === 'old_address'/)
})

test('sending stops after a quota refusal until Google’s next day', () => {
  const now = new Date('2026-10-16T12:00:00Z') // 05:00 Pacific
  const refusal = { ok: false, error: 'Quota exceeded for quota metric', attempted_at: '2026-10-16T09:00:00Z' }
  assert.equal(isQuotaError(refusal.error), true)
  assert.equal(quotaReachedToday([refusal], now), true)
  // A refusal from Google's previous day does not stop today.
  assert.equal(quotaReachedToday([{ ...refusal, attempted_at: '2026-10-16T06:00:00Z' }], now), false)
  assert.equal(quotaReachedToday([{ ok: false, error: 'Permission denied', attempted_at: '2026-10-16T09:00:00Z' }], now), false)
  const g = src('lib/googleIndexing.ts')
  assert.match(g, /if \(await quotaRefusedToday\(admin\)\)/)
  // A quota refusal during a run breaks out of the loop.
  const drain = g.slice(g.indexOf('export async function drainIndexingQueue'))
  assert.match(drain.slice(0, 6000), /isQuotaError[\s\S]{0,600}break/)
})

test('one waiting notice per address, newest kept, priority order kept', () => {
  const n = (id: number, url: string, created: string, priority = 0, kind: 'URL_UPDATED' | 'URL_DELETED' = 'URL_UPDATED') => ({
    id,
    url,
    kind,
    created_at: created,
    priority,
    next_attempt_at: null,
  })
  const a = `${BASE}/tuitions/lahore/a-aaaaaa`
  const b = `${BASE}/tuitions/lahore/b-bbbbbb`
  const plan = planDrain([n(1, a, '2026-10-16T01:00:00Z'), n(2, a, '2026-10-16T02:00:00Z'), n(3, b, '2026-10-16T00:00:00Z', 2)], 0, 200)
  assert.deepEqual(plan.superseded, [1])
  assert.deepEqual(
    plan.send.map((x) => x.id),
    [3, 2],
  )
})

test('"Last 10 errors" are newest first', () => {
  const rows = [{ attempted_at: '2026-10-15T01:00:00Z' }, { attempted_at: '2026-10-16T01:00:00Z' }, { attempted_at: '2026-10-14T01:00:00Z' }]
  assert.deepEqual(
    newestFirst(rows).map((r) => r.attempted_at),
    ['2026-10-16T01:00:00Z', '2026-10-15T01:00:00Z', '2026-10-14T01:00:00Z'],
  )
  assert.match(src('lib/googleIndexing.ts'), /order\('attempted_at', \{ ascending: false \}\)/)
})

test('paused 61 days ago: not in the sitemap; 59 days: in it', () => {
  const now = Date.now()
  const cand = (slug: string, pausedDaysAgo: number) => ({
    path: `/tuitions/lahore/${slug}`,
    status: 'paused',
    pausedAt: new Date(now - pausedDaysAgo * DAY).toISOString(),
    isFixture: false,
    descriptionLength: 80,
  })
  const urls = tuitionSitemapEntries(BASE, [cand('kept-aaaaaa', 59), cand('gone-bbbbbb', 61)]).map((e) => e.url)
  assert.deepEqual(urls, [`${BASE}/tuitions/lahore/kept-aaaaaa`])
  // The SQL the sitemap reads applies the same 60 days.
  assert.match(src('supabase/migrations/178_tuitions_on_google.sql'), /paused_at > now\(\) - interval '60 days'/)
})

test('a sitemap lastmod is never later than now', () => {
  const now = Date.parse('2026-10-16T10:00:00Z')
  assert.equal(iso('2026-10-17T00:00:00Z', now), new Date(now).toISOString())
  assert.equal(iso('2026-10-15T00:00:00Z', now), '2026-10-15T00:00:00.000Z')
})

test('Locations approvals are Owner-only on the server and capped per request', () => {
  const route = src('app/api/admin/locations/route.ts')
  const post = route.slice(route.indexOf('export async function POST'))
  assert.match(post, /refuseUnlessOwnerApproval\(gate\.actor, 'Locations: approve typed areas'\)/)
  assert.ok(post.indexOf('refuseUnlessOwnerApproval') < post.indexOf('applyLocationActions'), 'the Owner check comes before any write')
  assert.match(route, /max\(REVIEW_BATCH_MAX/)
  const area = src('app/api/admin/locations/area/route.ts')
  assert.match(area, /refuseUnlessOwnerApproval\(actor, 'Locations: merge an area'/)
  assert.doesNotMatch(area, /approve_all/)
  // The screens hide approval controls from everyone but the Owner.
  for (const f of ['app/admin/seo/locations/LocationsReviewClient.tsx', 'app/admin/seo/locations/StaffAddedAreas.tsx']) {
    assert.match(src(f), /useCanApprove\(\)/)
  }
})

test('bulk approval runs in batches; a failed batch never stops the rest', async () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  const seen: number[] = []
  const out = await runBatches([1, 2, 3, 4, 5, 6], 2, async (batch) => {
    if (batch.includes(3)) throw new Error('network')
    return batch.map((x) => (x === 6 ? 'bad row' : true))
  }, (done) => seen.push(done))
  assert.deepEqual(out.done, [1, 2, 5])
  assert.deepEqual(
    out.failed.map((f) => [f.item, f.error]),
    [
      [3, 'network'],
      [4, 'network'],
      [6, 'bad row'],
    ],
  )
  assert.deepEqual(seen, [2, 4, 6])
  // Every kind is confirmed with a count and a sample before anything is sent.
  const client = src('app/admin/seo/locations/LocationsReviewClient.tsx')
  assert.match(client, /await confirm\(/)
  assert.match(client, /data\.sample/)
  assert.match(client, /runBatches\(items, BATCH/)
})
