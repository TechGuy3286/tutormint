// scripts/test-seo-crawl.ts — crawlable paths to every open tuition, the
// tuitions sitemap, JobPosting, the Indexing API rules and the Mianwali 404s
// (owner, 16 Nov 2026). Invented data only; nothing reads or writes a database.
//
//   npx tsx --test scripts/test-seo-crawl.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { knownCityForSegment, nearbyCities, pageCount, pageHref, pageLinkNumbers } from '../lib/crawlLinksCore'
import { tuitionSitemapEntries } from '../lib/sitemapCore'
import { pauseDueAtMs, tuitionPublicState, TUITION_LIVE_DAYS, PAUSED_BANNER_TEXT } from '../lib/tuitionStatus'
import { validateJobPosting } from '../lib/jobPostingCore'
import { jobPostingJsonLd } from '../lib/seo'
import {
  desiredNotice,
  goneNoticesNeeded,
  indexingKindForStatus,
  noticeSendable,
  noticeTier,
  planDrain,
  INDEXING_DAILY_LIMIT,
  type NoticeFacts,
  type QueuedNotice,
} from '../lib/googleIndexingCore'
import { hiddenTuitionTarget } from '../lib/hiddenTuitionCore'
import { citySegment } from '../lib/slugs'

const read = (p: string) => readFileSync(p, 'utf8')
const DAY = 86_400_000
const NOW = Date.parse('2026-11-16T12:00:00Z')
const BASE = 'https://www.tutormint.org'

// ------------------------------------------------- 1. numbered page links --

test('city pages: numbered links reach every page, and the pages hold every open tuition', () => {
  for (const total of [0, 1, 12, 13, 100, 233]) {
    const pages = pageCount(total, 12)
    const nums = pageLinkNumbers(1, pages)
    if (pages > 1) assert.deepEqual(nums, Array.from({ length: pages }, (_, i) => i + 1), `every page linked for ${total}`)
    // Pages 1..n at 12 a page cover every tuition exactly once.
    const covered = new Set<number>()
    for (let p = 1; p <= pages; p++) for (let i = (p - 1) * 12; i < Math.min(total, p * 12); i++) covered.add(i)
    assert.equal(covered.size, total)
  }
  // A very long list: first, last and a window, with gaps.
  const long = pageLinkNumbers(40, 100)
  assert.equal(long[0], 1)
  assert.equal(long[long.length - 1], 100)
  assert.ok(long.includes(40) && long.includes(null))
  assert.equal(pageHref('/tuition-jobs/lahore', 1), '/tuition-jobs/lahore')
  assert.equal(pageHref('/tuition-jobs/lahore', 2), '/tuition-jobs/lahore?page=2')
  assert.equal(pageHref('/browse/tuitions', 3, { city: 'Lahore', q: '' }), '/browse/tuitions?city=Lahore&page=3')
})

test('city pages and /browse/tuitions render the numbered links as real <a href>', () => {
  const view = read('components/tuitionJobs/CityJobsView.tsx')
  assert.match(view, /<PageLinks path=\{path\} page=\{pageNo\} pages=\{pages\}/)
  const browse = read('app/(site)/browse/tuitions/BrowseTuitionsView.tsx')
  assert.match(browse, /<PageLinks\s+path="\/browse\/tuitions"/)
  const links = read('components/seo/PageLinks.tsx')
  assert.match(links, /<Link[\s\S]*href=\{pageHref\(path, n, params\)\}/)
  // ?page= still resolves on the server (the /qs twin), city and variant alike.
  assert.match(read('app/(site)/qs/tuition-jobs/[city]/page.tsx'), /sp\.page/)
})

test('city pages link nearby cities (nearest first) and the homepage + Browse link every city with open tuitions', () => {
  const cities = [{ city: 'Karachi' }, { city: 'Islamabad' }, { city: 'Rawalpindi' }, { city: 'Lahore' }]
  assert.deepEqual(nearbyCities('Islamabad', cities).map((c) => c.city), ['Rawalpindi', 'Lahore', 'Karachi'])
  assert.match(read('components/home/HomeLinks.tsx'), /cityPagesCachedForLinks\(\)/)
  assert.match(read('components/tuitionJobs/CityJobsLinks.tsx'), /cityPagesCachedForLinks\(\)/)
  assert.match(read('components/tuitionJobs/CityJobsView.tsx'), /nearbyCities\(page\.city/)
  // Every tuition page links its city page and carries the breadcrumb.
  const tp = read('app/(site)/tuitions/[city]/[slug]/page.tsx')
  assert.match(tp, /const cityHub = job\.city \? \{ citySlug: citySegment\(job\.city\), city: job\.city \} : null/)
  assert.match(tp, /label: 'Tuition jobs', href: '\/browse\/tuitions'/)
})

// -------------------------------------------------------------- 2. sitemap --

test('tuitions sitemap: open tuitions only, lastmod = last real change', () => {
  const recent = new Date(NOW - 5 * DAY).toISOString()
  const out = tuitionSitemapEntries(BASE, [
    { path: '/tuitions/lahore/maths-aaaaaa', status: 'open', isFixture: false, descriptionLength: 40, lastmod: '2026-11-15T10:00:00Z' },
    { path: '/tuitions/lahore/physics-bbbbbb', status: 'paused', pausedAt: recent, isFixture: false, descriptionLength: 40 },
    { path: '/tuitions/lahore/english-cccccc', status: 'closed', isFixture: false, descriptionLength: 40 },
    { path: '/tuitions/lahore/urdu-dddddd', status: 'hidden', isFixture: false, descriptionLength: 40 },
    { path: '/tuitions/lahore/chem-eeeeee', status: 'open', merged: true, isFixture: false, descriptionLength: 40 },
  ])
  assert.deepEqual(out.map((e) => e.url), [`${BASE}/tuitions/lahore/maths-aaaaaa`])
  assert.equal(out[0].lastmod, '2026-11-15T10:00:00Z')
  // A paused page is still indexable for 60 days, but never listed.
  const p = tuitionPublicState('paused', recent, NOW)
  assert.equal(p.indexable, true)
  assert.equal(p.inSitemap, false)
  // The loader no longer dates a tuition by its pause; city pages carry their own newest tuition.
  const src = read('lib/sitemaps.ts')
  assert.match(src, /newestOf\(\[r\.created_at, r\.resumed_at, r\.refreshed_at, r\.bumped_at\]\)/)
  assert.match(src, /lastmod: at\(c\.newestMs\)/)
})

// ----------------------------------------------------------- 3. JobPosting --

const posted = '2026-11-10T09:00:00Z'
const base = {
  url: `${BASE}/tuitions/lahore/maths-aaaaaa`,
  title: 'Female Home Tutor Required | Grade 5 | Johar Town | Lahore',
  description: 'A home tutor for Grade 5 Mathematics in Johar Town, Lahore. Three days a week in the evening.',
  datePosted: posted,
  validThrough: new Date(pauseDueAtMs(posted)).toISOString(),
  city: 'Lahore',
  area: 'Johar Town',
  subjects: ['Mathematics'],
  budgetMin: null as number | null,
  budgetMax: null as number | null,
  refId: 'TM-9999',
}

test('JobPosting: valid for an open tuition; validThrough = posted + 20 days; hiringOrganization TutorMint', () => {
  const j = jobPostingJsonLd(base) as Record<string, unknown>
  assert.deepEqual(validateJobPosting(j, Date.parse('2026-11-12T00:00:00Z')).filter((p) => p.level === 'required'), [])
  assert.equal(j.validThrough, new Date(Date.parse(posted) + TUITION_LIVE_DAYS * DAY).toISOString())
  const org = j.hiringOrganization as Record<string, unknown>
  assert.equal(org.name, 'TutorMint')
  assert.ok(org.logo)
  const addr = (j.jobLocation as { address: Record<string, unknown> }).address
  assert.equal(addr.addressLocality, 'Lahore')
  assert.equal(addr.addressRegion, 'Punjab')
  assert.equal(addr.addressCountry, 'PK')
  assert.ok(j.employmentType)
  assert.equal(j.baseSalary, undefined, 'no fee → no baseSalary')
  // A post that names its school keeps the school.
  assert.equal((jobPostingJsonLd({ ...base, schoolName: 'Invented Grammar School' }) as { hiringOrganization: { name: string } }).hiringOrganization.name, 'Invented Grammar School')
  // A fee → a monthly PKR range.
  const fee = jobPostingJsonLd({ ...base, budgetMin: 10000, budgetMax: 20000 }) as { baseSalary: { currency: string; value: { unitText: string; minValue: number; maxValue: number } } }
  assert.deepEqual([fee.baseSalary.currency, fee.baseSalary.value.unitText, fee.baseSalary.value.minValue, fee.baseSalary.value.maxValue], ['PKR', 'MONTH', 10000, 20000])
  // Online → TELECOMMUTE + Pakistan.
  const on = jobPostingJsonLd({ ...base, online: true }) as Record<string, unknown>
  assert.equal(on.jobLocationType, 'TELECOMMUTE')
  assert.deepEqual(on.applicantLocationRequirements, { '@type': 'Country', name: 'Pakistan' })
})

test('paused or closed: 200 page, "no longer open", noindex (closed / paused 60+ days), no JobPosting', () => {
  const recent = new Date(NOW - 10 * DAY).toISOString()
  const old = new Date(NOW - 61 * DAY).toISOString()
  for (const [status, at, indexable] of [['paused', recent, true], ['paused', old, false], ['closed', null, false], ['hired', null, false]] as const) {
    const s = tuitionPublicState(status, at, NOW)
    assert.equal(s.emitJobPosting, false)
    assert.equal(s.inSitemap, false)
    assert.equal(s.indexable, indexable, `${status} ${at}`)
  }
  assert.equal(PAUSED_BANNER_TEXT, 'This tuition is no longer open')
  assert.equal(tuitionPublicState('closed').banner?.text, 'This tuition is no longer open')
  assert.match(read('app/(site)/tuitions/[city]/[slug]/page.tsx'), /See open tuitions in \{job\.city\}/)
})

// ------------------------------------------------------- 4. Indexing API --

const f = (status: string, extra: Partial<NoticeFacts> = {}): NoticeFacts => ({ status, touchedMs: NOW - DAY, expired: false, ...extra })

test('Indexing: URL_UPDATED for open and paused; URL_DELETED once the page is noindex', () => {
  assert.equal(indexingKindForStatus('open'), 'URL_UPDATED')
  assert.equal(indexingKindForStatus('paused'), 'URL_UPDATED')
  for (const s of ['closed', 'hired', 'hidden']) assert.equal(indexingKindForStatus(s), 'URL_DELETED')
  assert.equal(desiredNotice(f('open'), NOW), 'URL_UPDATED')
  assert.equal(desiredNotice(f('open', { expired: true }), NOW), null)
  assert.equal(desiredNotice(f('paused', { pausedAt: new Date(NOW - 5 * DAY).toISOString() }), NOW), 'URL_UPDATED')
  assert.equal(desiredNotice(f('paused', { pausedAt: new Date(NOW - 61 * DAY).toISOString() }), NOW), 'URL_DELETED')
  assert.equal(desiredNotice(f('closed'), NOW), 'URL_DELETED')
  assert.equal(desiredNotice(f('open', { merged: true }), NOW), 'URL_DELETED')
  // A stale notice is not sent: a delete for a resumed tuition, an update for a closed one.
  assert.equal(noticeSendable(f('open'), 'URL_DELETED', NOW), 'not_open')
  assert.equal(noticeSendable(f('closed'), 'URL_UPDATED', NOW), 'not_open')
  assert.equal(noticeSendable(f('closed'), 'URL_DELETED', NOW), 'ok')
  // Open first, then paused updates, then deletions.
  const paused = f('paused', { pausedAt: new Date(NOW - 5 * DAY).toISOString() })
  assert.ok(noticeTier(f('open'), NOW) < noticeTier(paused, NOW))
  assert.ok(noticeTier(paused, NOW) < noticeTier(f('closed'), NOW, 'URL_DELETED') || noticeTier(f('closed'), NOW, 'URL_DELETED') === 3)
})

test('Indexing: within 200 a day, open first; the rest waits for the next day', () => {
  const notices: QueuedNotice[] = []
  const facts = new Map<string, NoticeFacts>()
  for (let i = 0; i < 260; i++) {
    const url = `${BASE}/tuitions/lahore/t-${String(i).padStart(6, 'a')}`
    const closed = i < 30
    notices.push({ id: i + 1, url, kind: closed ? 'URL_DELETED' : 'URL_UPDATED', created_at: new Date(NOW - i * 60_000).toISOString() })
    facts.set(url, closed ? f('closed') : f('open'))
  }
  const plan = planDrain(notices, 0, INDEXING_DAILY_LIMIT, NOW, facts)
  assert.equal(plan.send.length, 200)
  assert.ok(plan.send.every((n) => n.kind === 'URL_UPDATED'), 'deletions wait behind open tuitions')
  assert.equal(planDrain(notices, 150, INDEXING_DAILY_LIMIT, NOW, facts).send.length, 50)
  assert.equal(planDrain(notices, 200, INDEXING_DAILY_LIMIT, NOW, facts).send.length, 0)
})

test('Indexing: queued on post, edit, pause and close; the gone sweep; never while a page is built', () => {
  const jobs = read('lib/jobs.ts')
  assert.match(jobs, /queueIndexingUpdate\(/)
  assert.match(jobs, /queueIndexingDelete\(/)
  assert.match(read('lib/tuitionPause.ts'), /enqueueIndexing\(urls, 'URL_UPDATED'/)
  assert.match(read('app/api/admin/jobs/action/route.ts'), /queueIndexingForStatus\(/)
  assert.match(read('app/api/cron/subscriptions/route.ts'), /queueGoneTuitionNotices\(\)/)
  const idx = read('lib/googleIndexing.ts')
  assert.match(idx, /export function indexingAllowedNow[\s\S]{0,120}return phase !== 'static'/)
  assert.match(idx, /function runAfter\(fn: \(\) => Promise<void>\): void \{\s*if \(!indexingAllowedNow\(\)\) return/)
  // The gone sweep: only when Google's newest SENT notice was an update.
  const u = (s: string) => `${BASE}/tuitions/lahore/${s}`
  const tuitions = [
    { url: u('closed-aaaaaa'), facts: f('closed') },
    { url: u('never-bbbbbb'), facts: f('closed') },
    { url: u('told-cccccc'), facts: f('closed') },
    { url: u('open-dddddd'), facts: f('open') },
    { url: u('oldpause-eeeeee'), facts: f('paused', { pausedAt: new Date(NOW - 70 * DAY).toISOString() }) },
  ]
  const notices = [
    { id: 1, url: u('closed-aaaaaa'), kind: 'URL_UPDATED' as const, sent_at: '2026-11-01T00:00:00Z', skip_reason: null },
    { id: 2, url: u('told-cccccc'), kind: 'URL_UPDATED' as const, sent_at: '2026-11-01T00:00:00Z', skip_reason: null },
    { id: 3, url: u('told-cccccc'), kind: 'URL_DELETED' as const, sent_at: '2026-11-02T00:00:00Z', skip_reason: null },
    { id: 4, url: u('open-dddddd'), kind: 'URL_UPDATED' as const, sent_at: '2026-11-01T00:00:00Z', skip_reason: null },
    { id: 5, url: u('oldpause-eeeeee'), kind: 'URL_UPDATED' as const, sent_at: '2026-09-01T00:00:00Z', skip_reason: null },
  ]
  assert.deepEqual(goneNoticesNeeded(tuitions, notices, NOW).sort(), [u('closed-aaaaaa'), u('oldpause-eeeeee')].sort())
})

// --------------------------------------------- 5. Mianwali and city gaps --

test('Mianwali: a known city with no open tuition — city page 200 noindex, the rest redirect to it', () => {
  const known = ['Lahore', 'Mianwali', 'Karachi']
  assert.equal(knownCityForSegment('mianwali', known, citySegment), 'Mianwali')
  assert.equal(knownCityForSegment('atlantis', known, citySegment), null)
  // A hidden tuition goes to its city page even when the city has none open.
  assert.equal(hiddenTuitionTarget('Mianwali', false), '/tuition-jobs/mianwali')
  // /tuition-jobs/mianwali: 200 + noindex, "No tuitions here yet".
  const city = read('app/(site)/tuition-jobs/[city]/page.tsx')
  assert.match(city, /if \(page\.count === 0\) \{[\s\S]*robots: \{ index: false, follow: true \}/)
  assert.match(read('app/(site)/tuition-jobs/[city]/render.tsx'), /cityPageOrEmpty\(city\)/)
  assert.match(read('components/tuitionJobs/CityJobsView.tsx'), /'No tuitions here yet'/)
  // /tuition-jobs/mianwali/female → the city page.
  assert.match(read('app/(site)/tuition-jobs/[city]/[variant]/render.tsx'), /permanentRedirect\(cityPagePath\(page\?\.citySlug \?\? citySegment\(cityName\)\)\)/)
  // /tuitions/mianwali/<landing or gone tuition> → the city page.
  const tp = read('app/(site)/tuitions/[city]/[slug]/page.tsx')
  assert.match(tp, /if \(!combo\) return goneToCityPage\(citySeg\)/)
  assert.match(tp, /if \(!job\) return goneToCityPage\(citySeg\)/)
  assert.match(tp, /permanentRedirect\(cityPagePath\(citySegment\(city\)\)\)/)
})
