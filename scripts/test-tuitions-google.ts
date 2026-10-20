/**
 * scripts/test-tuitions-google.ts — the "tuitions on Google" PR (owner,
 * 16 Oct 2026): paused pages stay live and indexable for 60 days, a clean
 * sitemap, the Indexing API queue (Pacific day, priority, retries), "Started
 * payment, didn't finish", the area + landmark split, the staff city list and
 * the title check.   npm run test:tuitionsgoogle
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { tuitionPublicState, pausedStillIndexable, PAUSED_INDEXABLE_DAYS, PAUSED_BANNER_TEXT } from '../lib/tuitionStatus'
import { tuitionIndexable } from '../lib/seo/indexable'
import { tuitionSitemapEntries } from '../lib/sitemapCore'
import {
  indexingKindForStatus,
  planDrain,
  pacificDayStart,
  nextPacificDayStart,
  retryDelayMs,
  isQuotaError,
  indexingDays,
  MAX_ATTEMPTS,
  PRIORITY_BATCH,
  PRIORITY_CHANGE,
  PRIORITY_NEW_POST,
  type QueuedNotice,
} from '../lib/googleIndexingCore'
import { pickNewest } from '../lib/newestTuitionsCore'
import {
  isStartedNotFinished,
  startedNotFinished,
  fillPaymentNotFinished,
  payAgainLink,
  PAYMENT_NOT_FINISHED_FALLBACK,
  STARTED_PAYMENT_CLEAR_MS,
  type StartedCheckout,
} from '../lib/startedPaymentCore'
import { unpaidRowMatches, tutorInScope, parseTutorScope } from '../lib/staffOutreachCore'
import { splitAreaLandmark, areaWithLandmark, matchCuratedCity } from '../lib/staffAreaCore'
import { checkTuitionTitle, levelMismatch, schoolSlotJunk, withoutTrailingCommas } from '../lib/tuitionTitleCheck'
import { knownSchools } from '../lib/schoolJobsCore'
import { buildTuitionTitle } from '../lib/tuitionTitle'

const read = (p: string) => readFileSync(p, 'utf8')
const DAY = 86_400_000
const NOW = Date.parse('2026-10-16T12:00:00Z')
const BASE = 'https://www.tutormint.org'

// --- B1: paused pages ---------------------------------------------------------

test('paused: 200 page, indexable, banner, no JobPosting, no contact — for 60 days', () => {
  const recent = new Date(NOW - 10 * DAY).toISOString()
  const s = tuitionPublicState('paused', recent, NOW)
  assert.equal(s.indexable, true)
  assert.equal(s.inSitemap, true)
  assert.equal(s.emitJobPosting, false)
  assert.equal(s.acceptsApplications, false)
  assert.equal(s.showContact, false)
  assert.equal(s.banner?.text, PAUSED_BANNER_TEXT)
  assert.equal(PAUSED_BANNER_TEXT, 'This tuition is no longer accepting applications')
  assert.equal(tuitionIndexable({ status: 'paused', isFixture: false, pausedAt: recent, now: NOW }), true)
})

test('paused: noindex and out of the sitemap after 60 days (the page stays live)', () => {
  assert.equal(PAUSED_INDEXABLE_DAYS, 60)
  const day59 = new Date(NOW - 59 * DAY).toISOString()
  const day61 = new Date(NOW - 61 * DAY).toISOString()
  assert.equal(pausedStillIndexable('paused', day59, NOW), true)
  assert.equal(pausedStillIndexable('paused', day61, NOW), false)
  assert.equal(tuitionPublicState('paused', day61, NOW).indexable, false)
  assert.equal(tuitionIndexable({ status: 'paused', isFixture: false, pausedAt: day61, now: NOW }), false)
  assert.equal(tuitionIndexable({ status: 'paused', isFixture: false, pausedAt: null, now: NOW }), false, 'no paused_at → old')
  // Closed and hired never indexable; a fixture never.
  assert.equal(tuitionIndexable({ status: 'closed', isFixture: false, pausedAt: day59, now: NOW }), false)
  assert.equal(tuitionIndexable({ status: 'paused', isFixture: true, pausedAt: day59, now: NOW }), false)
  // The SQL mirror uses the same 60 days.
  assert.match(read('supabase/migrations/178_tuitions_on_google.sql'), /paused_at > now\(\) - interval '60 days'/)
})

test('resume: open again → JobPosting, same URL, fresh validThrough', () => {
  const s = tuitionPublicState('open', null, NOW)
  assert.equal(s.emitJobPosting, true)
  assert.equal(s.indexable, true)
  const page = read('app/(site)/tuitions/[city]/[slug]/page.tsx')
  assert.match(page, /state\.emitJobPosting && !repeatOf/)
  assert.match(page, /pauseDueAtMs\(job\.resumed_at \?\? job\.created_at\)/, 'validThrough from the resume clock')
  assert.match(page, /tuitionPublicState\(job\.status, job\.paused_at \?\? null\)/)
  assert.match(page, /pausedAt: job\.paused_at \?\? null/, 'metadata robots reads the same rule')
  // Apply and the contact line are hidden while not open.
  assert.match(page, /state\.showContact && job\.contactTeaser/)
  assert.match(page, /isTutor && state\.showContact && <ContactReveal/)
  // "Similar open tuitions": same city + subject/level first, then the city.
  assert.match(page, /'Similar open tuitions'/)
  assert.match(page, /state\.isOpen \? 'neighbours' : 'match-first'/)
  assert.match(read('lib/jobFeed.ts'), /order === 'match-first'/)
  // Every tuition page links its city hub and its city × subject hub.
  assert.match(page, /See all tuition jobs in \{cityHub\.city\}/)
  assert.match(page, /  if \(job\.city\) \{\n    \/\/ The first of this/)
})

// --- B2: sitemap --------------------------------------------------------------

test('sitemap: open and recently paused only — never closed, old paused, merged or a fixture', () => {
  const recent = new Date(Date.now() - 5 * DAY).toISOString()
  const old = new Date(Date.now() - 70 * DAY).toISOString()
  const out = tuitionSitemapEntries(BASE, [
    { path: '/tuitions/lahore/a-1', status: 'open', isFixture: false, descriptionLength: 80 },
    { path: '/tuitions/lahore/b-2', status: 'paused', pausedAt: recent, isFixture: false, descriptionLength: 80 },
    { path: '/tuitions/lahore/c-3', status: 'paused', pausedAt: old, isFixture: false, descriptionLength: 80 },
    { path: '/tuitions/lahore/d-4', status: 'closed', isFixture: false, descriptionLength: 80 },
    { path: '/tuitions/lahore/e-5', status: 'open', merged: true, isFixture: false, descriptionLength: 80 },
    { path: '/tuitions/lahore/f-6', status: 'open', isFixture: true, descriptionLength: 80 },
    { path: '/tuitions/lahore/g-7?x=1', status: 'open', isFixture: false, descriptionLength: 80 },
  ])
  assert.deepEqual(out.map((e) => e.url), [`${BASE}/tuitions/lahore/a-1`, `${BASE}/tuitions/lahore/b-2`])
  const src = read('lib/sitemaps.ts')
  assert.match(src, /rpc\('indexable_tuitions'\)/)
  assert.match(src, /!repeats\.has\(r\.public_slug\)/, 'a repeat (canonical elsewhere) is never listed')
  assert.match(read('supabase/migrations/178_tuitions_on_google.sql'), /j\.merged_into is null/)
})

// --- B3: Indexing API --------------------------------------------------------

const n = (id: number, url: string, kind: QueuedNotice['kind'], minute: number, priority = 0, next: string | null = null): QueuedNotice => ({
  id,
  url: `${BASE}/tuitions/lahore/${url}`,
  kind,
  created_at: new Date(Date.UTC(2026, 9, 16, 0, minute)).toISOString(),
  priority,
  next_attempt_at: next,
})

test('indexing: paused is URL_UPDATED (the page still exists); closed and hired are URL_DELETED', () => {
  for (const s of ['open', 'paused']) assert.equal(indexingKindForStatus(s), 'URL_UPDATED')
  for (const s of ['closed', 'hired']) assert.equal(indexingKindForStatus(s), 'URL_DELETED')
  assert.match(read('lib/tuitionPause.ts'), /enqueueIndexing\(urls, 'URL_UPDATED', PRIORITY_CHANGE\)/)
  assert.match(read('lib/selfPause.ts'), /queueIndexingUpdate\(j\)/)
})

test('indexing: never more than 200 in Google\'s day, whatever the caller asks', () => {
  const pending = Array.from({ length: 450 }, (_, i) => n(i + 1, `t${i}`, 'URL_UPDATED', i % 50))
  assert.equal(planDrain(pending, 0, 1000, NOW).send.length, 200)
  assert.equal(planDrain(pending, 199, 200, NOW).send.length, 1)
  assert.equal(planDrain(pending, 200, 200, NOW).send.length, 0)
  assert.equal(planDrain(pending, 250, 200, NOW).send.length, 0)
})

test('indexing: new posts first, then changes, then batch re-sends; oldest first within each', () => {
  const plan = planDrain(
    [n(1, 'batch-old', 'URL_UPDATED', 0, PRIORITY_BATCH), n(2, 'paused', 'URL_UPDATED', 5, PRIORITY_CHANGE), n(3, 'new-post', 'URL_UPDATED', 30, PRIORITY_NEW_POST), n(4, 'closed', 'URL_DELETED', 1, PRIORITY_CHANGE)],
    0,
    200,
    NOW,
  )
  assert.deepEqual(plan.send.map((x) => x.id), [3, 2, 4, 1])
  assert.match(read('lib/jobs.ts'), /queueIndexingUpdate\(\{ public_slug: \(job\.public_slug as string\) \?\? null, city: input\.city \}, \{ newPost: true \}\)/)
})

test('indexing: a retry waits for its time; backoff grows and is capped; quota waits for Pacific midnight', () => {
  const later = new Date(NOW + 60_000).toISOString()
  const earlier = new Date(NOW - 60_000).toISOString()
  const plan = planDrain([n(1, 'waiting', 'URL_UPDATED', 0, 0, later), n(2, 'due', 'URL_UPDATED', 1, 0, earlier)], 0, 200, NOW)
  assert.deepEqual(plan.send.map((x) => x.id), [2])
  assert.equal(retryDelayMs(1), 5 * 60_000)
  assert.equal(retryDelayMs(2), 10 * 60_000)
  assert.equal(retryDelayMs(20), 24 * 3_600_000)
  assert.ok(MAX_ATTEMPTS >= 3)
  assert.equal(isQuotaError("Quota exceeded for quota metric 'Publish requests'"), true)
  assert.equal(isQuotaError('Permission denied'), false)
  // Pacific day: 16 Oct 2026 12:00 UTC is 05:00 PDT → the day began 07:00 UTC.
  assert.equal(pacificDayStart(new Date(NOW)).toISOString(), '2026-10-16T07:00:00.000Z')
  assert.equal(nextPacificDayStart(new Date(NOW)).toISOString(), '2026-10-17T07:00:00.000Z')
  // In winter (PST, UTC-8) the day begins 08:00 UTC.
  assert.equal(pacificDayStart(new Date('2026-12-10T12:00:00Z')).toISOString(), '2026-12-10T08:00:00.000Z')
  const src = read('lib/googleIndexing.ts')
  assert.match(src, /retryDelayMs\(attempts\)/)
  assert.match(src, /nextPacificDayStart\(\)/)
  assert.match(src, /from\('indexing_attempts'\)\.insert/)
})

test('indexing: the 7-day chart groups attempts by Google day, oldest first', () => {
  const days = indexingDays(
    [
      { attempted_at: '2026-10-16T08:00:00Z', ok: true },
      { attempted_at: '2026-10-16T09:00:00Z', ok: false },
      { attempted_at: '2026-10-15T08:00:00Z', ok: true },
    ],
    new Date(NOW),
  )
  assert.equal(days.length, 7)
  assert.deepEqual(days[6], { day: '2026-10-16', ok: 1, failed: 1 })
  assert.deepEqual(days[5], { day: '2026-10-15', ok: 1, failed: 0 })
})

// --- B4: fresh internal links -----------------------------------------------------

test('newest tuitions: the latest 10 in the scope, newest posted first', () => {
  const rows = Array.from({ length: 14 }, (_, i) => ({
    id: `j${i}`,
    href: `/tuitions/lahore/j${i}`,
    title: `T${i}`,
    city: i % 2 ? 'Lahore' : 'Karachi',
    createdAt: new Date(NOW - i * DAY).toISOString(),
    bumpedAt: new Date(NOW - i * DAY).toISOString(),
  }))
  assert.deepEqual(pickNewest(rows, { city: null, ids: null }, 10).map((r) => r.id), rows.slice(0, 10).map((r) => r.id))
  assert.deepEqual(pickNewest(rows, { city: ' lahore ', ids: null }, 3).map((r) => r.id), ['j1', 'j3', 'j5'])
  assert.deepEqual(pickNewest(rows, { city: 'Lahore', ids: new Set(['j3', 'j9', 'j2']) }, 10).map((r) => r.id), ['j3', 'j9'])
  assert.match(read('components/home/HomeLinks.tsx'), /<NewestTuitions links=\{newest\} variant="row" \/>/)
  assert.match(read('components/tuitionJobs/CityJobsView.tsx'), /Newest tuitions in \$\{page\.city\}/)
  assert.match(read('components/landing/LandingView.tsx'), /newestTuitionLinks\(\{ city, masterId \}\)/)
})

// --- C: started payment ------------------------------------------------------------

const co = (over: Partial<StartedCheckout> = {}): StartedCheckout => ({
  id: 'p1',
  userId: 'u1',
  planCode: 'verified',
  status: 'pending',
  createdAt: new Date(NOW - 3 * 3_600_000).toISOString(),
  provider: 'paypro',
  hasReceipt: false,
  ...over,
})

test('started payment: listed after an hour, gone at 48 hours', () => {
  assert.equal(isStartedNotFinished(co({ createdAt: new Date(NOW - 30 * 60_000).toISOString() }), undefined, NOW), false, 'still at the gateway')
  assert.equal(isStartedNotFinished(co(), undefined, NOW), true)
  assert.equal(isStartedNotFinished(co({ createdAt: new Date(NOW - 47 * 3_600_000).toISOString() }), undefined, NOW), true)
  assert.equal(isStartedNotFinished(co({ createdAt: new Date(NOW - STARTED_PAYMENT_CLEAR_MS - 1).toISOString() }), undefined, NOW), false)
})

test('started payment: gone as soon as the member pays; a waiting receipt is not here', () => {
  const started = co().createdAt
  assert.equal(isStartedNotFinished(co(), { approved: [{ planCode: 'verified', at: new Date(NOW - 60_000).toISOString() }] }, NOW), false)
  assert.equal(isStartedNotFinished(co(), { approved: [{ planCode: 'premium', at: new Date(NOW).toISOString() }] }, NOW), true, 'a different package')
  assert.equal(isStartedNotFinished(co(), { approved: [{ planCode: 'verified', at: new Date(Date.parse(started) - DAY).toISOString() }] }, NOW), true, 'paid before — this is a new attempt')
  assert.equal(isStartedNotFinished(co(), { approved: [], feePaid: true }, NOW), false, 'fee already stamped')
  assert.equal(isStartedNotFinished(co({ hasReceipt: true, provider: 'manual' }), undefined, NOW), false)
  assert.equal(isStartedNotFinished(co({ status: 'approved' }), undefined, NOW), false)
  // One row per member and package: the newest.
  const list = startedNotFinished([co({ id: 'a' }), co({ id: 'b', createdAt: new Date(NOW - 2 * 3_600_000).toISOString() })], new Map(), NOW)
  assert.deepEqual(list.map((r) => r.id), ['b'])
})

test('started payment: the WhatsApp text and the Follow-ups chip', () => {
  const text = fillPaymentNotFinished(PAYMENT_NOT_FINISHED_FALLBACK, { name: 'Ayesha Khan', payLink: payAgainLink('verified') })
  assert.equal(
    text,
    "Assalam o Alaikum Ayesha, your TutorMint payment didn't complete. Need help? Here is your link to try again: https://www.tutormint.org/pay/choose?plan=verified. Support WhatsApp 0321 5872222.",
  )
  assert.equal(/\bRs\b|PKR|rupee/i.test(text), false, 'no amount')
  assert.equal(unpaidRowMatches({ stoppedAt: null, lastContactAt: null, startedPayment: true }, 'started_payment'), true)
  assert.equal(unpaidRowMatches({ stoppedAt: null, lastContactAt: null, startedPayment: false }, 'started_payment'), false)
  assert.equal(parseTutorScope('started_payment'), 'started_payment')
  assert.equal(tutorInScope({ joinedAt: new Date(NOW - 90 * DAY).toISOString(), feeStamped: true, feeApproved: true, onboarded: true, startedPayment: true }, 'started_payment', NOW), true)
  assert.match(read('lib/overviewItemsCore.ts'), /"Started payment, didn't finish"/)
  assert.match(read('supabase/migrations/180_started_payment_area_landmark.sql'), /'payment_not_finished'/)
})

// --- E: staff posting ----------------------------------------------------------------

const KARACHI = ['Clifton', 'Federal B Area', 'Gulshan-e-Iqbal', 'Saddar', 'Gulistan-e-Johar', 'North Nazimabad', 'PECHS', 'North Karachi', 'Lyari']

test('area: a typed area with a block or landmark splits into the main area + landmark', () => {
  const cases: [string, string, string][] = [
    ['Block 1 Clifton', 'Clifton', 'Block 1'],
    ['Clifton Block 8', 'Clifton', 'Block 8'],
    ['Federal B Area Block 16', 'Federal B Area', 'Block 16'],
    ['Federal B Area, Azizabad', 'Federal B Area', 'Azizabad'],
    ['Gulshan-e-Iqbal Block 10 -A', 'Gulshan-e-Iqbal', 'Block 10-A'],
    ['Saddar Near Taj Complex', 'Saddar', 'Near Taj Complex'],
    ['Gulistan-e-Johar Block 16', 'Gulistan-e-Johar', 'Block 16'],
    ['Block T North Nazimabad', 'North Nazimabad', 'Block T'],
    ['PECHS Block 2', 'PECHS', 'Block 2'],
    ['North Karachi Sector 11c-3', 'North Karachi', 'Sector 11c-3'],
    ['Near Chowk Gul Muhammad Lyari', 'Lyari', 'Near Chowk Gul Muhammad'],
  ]
  for (const [typed, area, landmark] of cases) assert.deepEqual(splitAreaLandmark('Karachi', typed, KARACHI), { area, landmark }, typed)
  assert.equal(splitAreaLandmark('Karachi', 'Clifton', KARACHI), null, 'exactly a curated area: nothing to split')
  assert.equal(splitAreaLandmark('Karachi', 'Malir Cantt', KARACHI), null, 'no curated match: Add as new area')
  assert.equal(areaWithLandmark('Clifton', 'Block 1'), 'Clifton (Block 1)')
  assert.equal(areaWithLandmark('Clifton', null), 'Clifton')
})

test('city: staff choose from the curated list only; free text is refused', () => {
  const cities = ['Faisalabad', 'Lahore', 'Peshawar']
  assert.equal(matchCuratedCity(cities, 'Peshawar,'), 'Peshawar')
  assert.equal(matchCuratedCity(cities, 'LAHORE'), 'Lahore')
  assert.equal(matchCuratedCity(cities, 'Jhelum'), null)
  assert.equal(matchCuratedCity(cities, 'faislabad'), null, 'a misspelling is not silently accepted')
  const jobs = read('lib/jobs.ts')
  assert.equal((jobs.match(/const curatedCity = await curatedCityName\(input\.city\)/g) ?? []).length, 2, 'create and edit')
  assert.match(jobs, /error: 'Choose the city from the list\.'/)
  // Since 20 Oct 2026 the staff city field is the searchable picker, list only
  // (no allowFreeText); parents keep free text.
  const whw = read('components/forms/WhereHowWhen.tsx')
  assert.match(whw, /\{staff \? \(\n\s+<div className="space-y-1">\n\s+<CityPicker value=\{city\} onChange=\{onCity\} icon=\{<Building2 size=\{15\} \/>\} \/>/)
  assert.match(whw, /\) : \(\n\s+<CityPicker value=\{city\} onChange=\{onCity\} icon=\{<Building2 size=\{15\} \/>\} allowFreeText \/>/)
})

test('title check: misspelt school, junk in the school slot, stray commas, post type vs level', () => {
  const known = knownSchools()
  const kinds = (o: Partial<Parameters<typeof checkTuitionTitle>[0]>) =>
    checkTuitionTitle({ title: '', school: '', jobType: null, levels: [], known, ...o }).map((w) => w.kind)
  const spell = checkTuitionTitle({ title: '', school: 'Beconhouse Schoolo', jobType: null, levels: [], known })
  assert.equal(spell[0].kind, 'school_spelling')
  assert.deepEqual(spell[0].fix, { field: 'school', value: 'Beaconhouse School', label: 'Use Beaconhouse School' })
  assert.deepEqual(kinds({ school: 'home tuition in' }), ['school_junk'])
  assert.deepEqual(kinds({ school: 'Academy' }), ['school_junk'])
  assert.equal(schoolSlotJunk('Roots Academy'), false)
  assert.deepEqual(kinds({ title: 'Home Tutor Required | Grade 6 | Gulshan, | Karachi' }), ['trailing_comma'])
  assert.equal(withoutTrailingCommas('A | B, | C,'), 'A | B | C')
  assert.equal(levelMismatch('O Levels Teacher', ['FSC ( Part I & Part II)']), 'FSC ( Part I & Part II)')
  assert.equal(levelMismatch('O Levels Teacher', ['O Levels']), null)
  assert.equal(levelMismatch('Primary Teacher', ['Grade 3']), null)
  assert.equal(levelMismatch('Home Tutor', ['FSC ( Part I & Part II)']), null, 'a home tutor fits any level')
  assert.deepEqual(kinds({ jobType: 'O Levels Teacher', levels: ['FSC ( Part I & Part II)'] }), ['level_mismatch'])
  // The builder uses the corrected values: no stray comma survives.
  assert.equal(buildTuitionTitle({ mode: 'Home Tutor', gender: null, levels: ['Grade 6'], area: 'Gulshan,', city: 'Karachi' }), 'Home Tutor Required | Grade 6 | Gulshan | Karachi')
})
