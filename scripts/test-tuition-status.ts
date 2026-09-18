/**
 * scripts/test-tuition-status.ts  —  npm run test:tuition
 *
 * Guards for PR28: a tuition's public page never 404s because of status.
 *
 * The route, its metadata and the sitemap all read tuitionPublicState, so these
 * assert the rules once: only OPEN is indexable, emits JobPosting and sits in the
 * sitemap; paused/closed/hired are 200 + noindex + no JobPosting + not in the
 * sitemap, and carry a plain banner (never the word "expired"). The
 * accepts-applications flag is the server gate the apply route reads (§4).
 *
 * The anon COLUMN set being identical for every status is proven by construction
 * and asserted by a source scan: jobByPublicSlug selects one fixed JOB_COLUMNS
 * with no status branch, so open and paused receive the same shape (§GUARDS).
 *
 * Uses node:test, like scripts/test-auth-trust.ts. Nothing here touches the DB.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { tuitionPublicState, daysUntilPause, PAUSE_AFTER_DAYS } from '../lib/tuitionStatus'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

test('open is fully live: indexable, JobPosting, sitemap, applications, no banner', () => {
  const s = tuitionPublicState('open')
  assert.equal(s.isOpen, true)
  assert.equal(s.acceptsApplications, true)
  assert.equal(s.indexable, true)
  assert.equal(s.emitJobPosting, true)
  assert.equal(s.inSitemap, true)
  assert.equal(s.banner, null)
})

for (const status of ['paused', 'closed', 'hired'] as const) {
  test(`${status} is 200 + noindex: no index, no JobPosting, no sitemap, no applications, has a banner`, () => {
    const s = tuitionPublicState(status)
    assert.equal(s.isOpen, false)
    assert.equal(s.acceptsApplications, false, 'apply/message/demo refused server-side for a non-open job')
    assert.equal(s.indexable, false, 'noindex')
    assert.equal(s.emitJobPosting, false, 'no JobPosting JSON-LD')
    assert.equal(s.inSitemap, false, 'not in the sitemap')
    assert.ok(s.banner, 'a plain status banner is shown')
  })
}

test('banner copy matches the DB vocabulary and never says "expired"', () => {
  assert.match(tuitionPublicState('paused').banner!.text, /not accepting applications/i)
  assert.match(tuitionPublicState('closed').banner!.text, /closed/i)
  assert.match(tuitionPublicState('hired').banner!.text, /hired/i)
  for (const status of ['paused', 'closed', 'hired'] as const) {
    assert.doesNotMatch(tuitionPublicState(status).banner!.text, /expired/i)
  }
})

test('an unknown / missing status defaults to open (a real row still renders 200)', () => {
  assert.equal(tuitionPublicState('').isOpen, true)
  assert.equal(tuitionPublicState(null).isOpen, true)
  assert.equal(tuitionPublicState(undefined).isOpen, true)
})

test('daysUntilPause counts down from the clock base + 15 and never goes negative', () => {
  const now = Date.parse('2026-01-20T00:00:00Z')
  // posted 5 days ago → pauses in 10
  assert.equal(daysUntilPause('2026-01-15T00:00:00Z', now), 10)
  // posted 15 days ago → due now (0), not negative
  assert.equal(daysUntilPause('2026-01-05T00:00:00Z', now), 0)
  // posted 20 days ago → still clamped at 0
  assert.equal(daysUntilPause('2025-12-31T00:00:00Z', now), 0)
  assert.equal(PAUSE_AFTER_DAYS, 15)
})

test('anon column set is identical for every status: jobByPublicSlug has no status branch', () => {
  const src = readFileSync(join(root, 'lib/jobFeed.ts'), 'utf8')
  // The function body from its declaration to the next export.
  const start = src.indexOf('export async function jobByPublicSlug')
  assert.ok(start >= 0, 'jobByPublicSlug exists')
  const body = src.slice(start, src.indexOf('export async function similarOpenTuitions'))
  assert.ok(body.includes('.select(JOB_COLUMNS)'), 'selects the one fixed JOB_COLUMNS set')
  assert.ok(!/\.eq\('status'/.test(body), 'does NOT filter by status — same columns for open and paused')
})

test('the sitemap RPC still lists open tuitions only (SQL is unchanged)', () => {
  const src = readFileSync(join(root, 'supabase/migrations/71_seed_noindex.sql'), 'utf8')
  const fn = src.slice(src.indexOf('indexable_job_slugs'))
  assert.ok(/j\.status = 'open'/.test(fn), "indexable_job_slugs filters status = 'open'")
})
