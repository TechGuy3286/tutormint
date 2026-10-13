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

import {
  tuitionPublicState,
  pauseCountdownLabel,
  isPauseDue,
  pauseDueAtMs,
  TUITION_LIVE_DAYS,
  LIVE_FLOOR_MS,
} from '../lib/tuitionStatus'

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

test('PART B — pauseCountdownLabel never shows 0 or a negative, and counts down', () => {
  const now = Date.parse('2027-01-20T00:00:00Z')
  const at = (iso: string) => pauseCountdownLabel(iso, now)
  // 15-day life (owner, 13 Oct 2026; was 7 from 8 Oct).
  assert.equal(at('2027-01-18T00:00:00Z'), 'pauses in 13 days') // base 2d ago → 13 days left
  assert.equal(at('2027-01-06T12:00:00Z'), 'pauses in 1 day')    // 1.5 days left → floor 1, singular
  // Under a day left, exactly due, and past due (unswept) all read "pauses today"
  assert.equal(at('2027-01-05T12:00:00Z'), 'pauses today')       // 0.5 day left
  assert.equal(at('2027-01-05T00:00:00Z'), 'pauses today')       // exactly due
  assert.equal(at('2026-12-20T00:00:00Z'), 'pauses today')       // past due
  // The strict guard: it never emits a "0" or a minus sign.
  for (const iso of ['2027-01-15T00:00:00Z', '2027-01-05T12:00:00Z', '2027-01-05T00:00:00Z', '2026-12-20T00:00:00Z']) {
    const label = at(iso)
    assert.doesNotMatch(label, /\b0\b/, `no zero in "${label}"`)
    assert.doesNotMatch(label, /-/, `no negative in "${label}"`)
  }
  assert.equal(TUITION_LIVE_DAYS, 15)
})

test('PART B — a past-due-but-unswept OPEN tuition reads "pauses today" and still accepts applications', () => {
  const now = Date.parse('2027-01-20T00:00:00Z')
  const base = '2027-01-01T00:00:00Z' // 19 days in — past the 15-day line
  assert.equal(isPauseDue(base, now), true, 'the sweep would pause it on its next run')
  assert.equal(pauseCountdownLabel(base, now), 'pauses today', 'never "paused", never a negative')
  // It is still status="open" until the sweep runs, so it still takes applications.
  assert.equal(tuitionPublicState('open').acceptsApplications, true)
})

test('15 days: resume gives a fresh 15 days, and validThrough is the same instant', () => {
  const DAY = 86_400_000
  const posted = '2027-02-01T10:00:00Z'
  assert.equal(pauseDueAtMs(posted), Date.parse(posted) + 15 * DAY)
  // Resume = a new clock base; the pause moves to resume + 15 days.
  const resumed = '2027-02-20T08:30:00Z'
  assert.equal(pauseDueAtMs(resumed), Date.parse(resumed) + 15 * DAY)
  assert.equal(isPauseDue(resumed, Date.parse(resumed) + 14.9 * DAY), false)
  assert.equal(isPauseDue(resumed, Date.parse(resumed) + 15 * DAY), true)
  // The tuition page hands JobPosting validThrough = pauseDueAtMs(clock base).
  const page = readFileSync(join(root, 'app/(site)/tuitions/[city]/[slug]/page.tsx'), 'utf8')
  assert.ok(page.replace(/\s+/g, '').includes('validThrough:newDate(pauseDueAtMs(job.resumed_at??job.created_at),).toISOString()'), 'validThrough = the pause instant')
})

test('the one-time floor: a tuition live on the day of the change is never due before it', () => {
  const DAY = 86_400_000
  // 15 days already run out on 13 Oct 2026 → live until the floor, not paused that day.
  assert.equal(pauseDueAtMs('2026-09-20T00:00:00Z'), LIVE_FLOOR_MS)
  assert.equal(isPauseDue('2026-09-20T00:00:00Z', Date.parse('2026-10-13T12:00:00Z')), false)
  assert.equal(isPauseDue('2026-09-20T00:00:00Z', LIVE_FLOOR_MS), true)
  // Still inside its 15 days → its own date.
  assert.equal(pauseDueAtMs('2026-10-10T00:00:00Z'), Date.parse('2026-10-10T00:00:00Z') + 15 * DAY)
})

test('no screen carries its own copy of the number', () => {
  for (const f of ['lib/hubCopy.ts', 'lib/notify/templates.ts', 'lib/pausedTuitions.ts', 'lib/tuitionPause.ts']) {
    const src = readFileSync(join(root, f), 'utf8')
    assert.ok(src.includes('TUITION_LIVE_LABEL'), `${f} reads the label`)
    assert.doesNotMatch(src, /7 days — resume|after 7 days|for 7 days|another 7 days/, `${f} has no 7-day text`)
  }
})

test('PART B — the sweep and the display share ONE expression (pauseDueAtMs)', () => {
  // Value check: isPauseDue is exactly "pauseDueAtMs <= now".
  const base = '2026-01-01T00:00:00Z'
  const due = pauseDueAtMs(base)
  assert.equal(isPauseDue(base, due - 1), false)
  assert.equal(isPauseDue(base, due), true)
  // Source check: the sweep imports isPauseDue from tuitionStatus, and both
  // isPauseDue and pauseCountdownLabel derive from pauseDueAtMs — one expression.
  const status = readFileSync(join(root, 'lib/tuitionStatus.ts'), 'utf8')
  assert.ok(/export function isPauseDue[\s\S]*?pauseDueAtMs/.test(status), 'isPauseDue uses pauseDueAtMs')
  assert.ok(/export function pauseCountdownLabel[\s\S]*?pauseDueAtMs/.test(status), 'the display uses pauseDueAtMs')
  // The sweep batches through lib/tuitionPauseCore (owner, 8 Oct 2026), whose
  // due test is pauseDueAtMs — the same expression as the display.
  const sweep = readFileSync(join(root, 'lib/tuitionPause.ts'), 'utf8')
  assert.ok(/planPauseBatch/.test(sweep), 'the sweep reads planPauseBatch (not its own cutoff)')
  const core = readFileSync(join(root, 'lib/tuitionPauseCore.ts'), 'utf8')
  assert.ok(/pauseDueAtMs/.test(core), 'the batch rule uses pauseDueAtMs')
  assert.ok(!/cutoffIso/.test(sweep), 'the sweep no longer has a second cutoff implementation')
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

test('PR30 — a pause notifies the POSTER only: one notification, one email, zero admin-directed', () => {
  const sweep = readFileSync(join(root, 'lib/tuitionPause.ts'), 'utf8')
  // Exactly one notify() and one deliverEmail() in the sweep, both keyed to the
  // poster (parent_id) — not the acting admin, not a staff fan-out.
  assert.equal((sweep.match(/\bnotify\(/g) ?? []).length, 1, 'one in-app notification')
  assert.equal((sweep.match(/deliverEmail\(/g) ?? []).length, 1, 'one email')
  assert.ok(/notify\(\{\s*userId:\s*j\.parent_id/.test(sweep), 'the notification goes to the poster')
  assert.ok(/deliverEmail\(\{\s*userId:\s*j\.parent_id/.test(sweep), 'the email goes to the poster')
  assert.ok(!/notifyMany|is_admin|adminMessage/.test(sweep), 'no admin-directed notification fires')
  // A team-posted tuition (poster = the team account) is emailed like any other
  // poster — never suppressed as "an admin email".
  assert.ok(!/is_team_account/.test(sweep), 'the team account is not suppressed as poster')
})

test('PR30 — the admin pause notifies the poster and keeps the audit row, not the acting admin', () => {
  const route = readFileSync(join(root, 'app/api/admin/jobs/action/route.ts'), 'utf8')
  assert.ok(/logAdminAction\(/.test(route), 'admin_audit_log row is written (the record, kept)')
  assert.ok(/notify\(\{[\s\S]*?userId:\s*job\.parent_id/.test(route), 'the member notification goes to the poster')
  assert.ok(!/userId:\s*gate\.actor/.test(route), 'the acting admin is never notified')
})

test('the sitemap RPC still lists open tuitions only (SQL is unchanged)', () => {
  const src = readFileSync(join(root, 'supabase/migrations/71_seed_noindex.sql'), 'utf8')
  const fn = src.slice(src.indexOf('indexable_job_slugs'))
  assert.ok(/j\.status = 'open'/.test(fn), "indexable_job_slugs filters status = 'open'")
})
