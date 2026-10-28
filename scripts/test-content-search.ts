/**
 * scripts/test-content-search.ts — the content queue from real searches, Claude
 * drafts, the Live jobs block, the indexing order and the sitemap rule
 * (owner, 28 Oct 2026).
 *
 *   npx tsx --test scripts/test-content-search.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  buildSearchTopics,
  gscAccessProblem,
  parseQueriesCsv,
  parseQuery,
  searchTopicCandidate,
  usableQueries,
  type TopicContext,
} from '../lib/contentQueue/searchTopics'
import { digestItems, digestLines } from '../lib/contentQueue/digestCore'
import { draftRow, fitMetaTitle } from '../lib/blogQueueDraftCore'
import { hasLiveJobs, liveJobsAllHref, parseLiveJobsLine, withLiveJobs, LIVE_JOBS_LIMIT } from '../lib/liveJobsCore'
import { parseMarkdown } from '../lib/markdown'
import { noticeSendable, noticeTier, planDrain, touchedAt, type NoticeFacts, type QueuedNotice } from '../lib/googleIndexingCore'
import { hubSitemapEntries } from '../lib/sitemapCore'

const ctx: TopicContext = {
  cities: ['Lahore', 'Karachi', 'Faisalabad', 'Islamabad'],
  areas: [
    { city: 'Lahore', area: 'Bahria Town' },
    { city: 'Karachi', area: 'North Nazimabad' },
    { city: 'Lahore', area: 'Johar Town' },
  ],
  pages: [
    { path: '/tuition-jobs/lahore', label: 'Tuition jobs in Lahore', kind: 'city', city: 'Lahore' },
    { path: '/tuition-jobs/lahore/female', label: 'Female teaching jobs in Lahore', kind: 'female', city: 'Lahore' },
    { path: '/tutors/lahore/o-levels-physics', label: 'O Levels Physics tutors in Lahore', kind: 'landing', city: 'Lahore', words: ['physics'] },
  ],
  posts: [],
}

const rows = [
  { query: 'jobs in lahore for female', clicks: 16, impressions: 102 },
  { query: 'Female teaching jobs Lahore', clicks: 1, impressions: 9 },
  { query: 'jobs', clicks: 3, impressions: 40 },
  { query: 'jobs in bahria town lahore', clicks: 2, impressions: 12 },
  { query: 'jobs faisalabad', clicks: 1, impressions: 8 },
  { query: 'school jobs in karachi', clicks: 1, impressions: 7 },
  { query: 'home tuition jobs in lahore', clicks: 2, impressions: 20 },
  { query: 'teaching jobs near me', clicks: 0, impressions: 6 },
  { query: 'school jobs north nazimabad', clicks: 0, impressions: 4 },
  { query: 'home tutor in lahore', clicks: 0, impressions: 30 },
  { query: 'o level physics tutor lahore', clicks: 0, impressions: 5 },
  { query: 'tutormint', clicks: 200, impressions: 900 },
  { query: 'tutor mint', clicks: 20, impressions: 60 },
  { query: 'rare search', clicks: 0, impressions: 2 },
]

test('only queries with 3+ impressions, never branded searches', () => {
  const q = usableQueries(rows).map((r) => r.query)
  assert.ok(!q.includes('rare search'))
  assert.ok(!q.some((x) => /tutor ?mint/i.test(x)))
  assert.ok(q.includes('school jobs north nazimabad'))
  // duplicates (case, spacing) are summed
  const merged = usableQueries([{ query: 'Jobs Lahore', clicks: 1, impressions: 2 }, { query: 'jobs  lahore', clicks: 0, impressions: 2 }])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].impressions, 4)
})

test('near-duplicates group; tutor-side topics come first', () => {
  const topics = buildSearchTopics(rows, ctx)
  const female = topics.find((t) => t.female && t.city === 'Lahore' && !t.area)
  assert.ok(female)
  assert.equal(female!.queries.length, 2)
  assert.equal(female!.impressions, 111)
  const firstParent = topics.findIndex((t) => t.side === 'parent')
  const lastTutor = topics.map((t) => t.side).lastIndexOf('tutor')
  assert.ok(firstParent > lastTutor, 'every tutor-side topic before the first parent topic')
  // an area with no city named takes its city from the area
  const nn = parseQuery('school jobs north nazimabad', ctx)
  assert.equal(nn.city, 'Karachi')
  assert.equal(nn.area, 'North Nazimabad')
  assert.equal(nn.side, 'tutor')
})

test('a topic a page already answers is "already covered", others are not', () => {
  const topics = buildSearchTopics(rows, ctx)
  const female = topics.find((t) => t.female && t.city === 'Lahore')!
  assert.equal(female.coveredBy?.path, '/tuition-jobs/lahore/female')
  const fsd = topics.find((t) => t.city === 'Faisalabad')!
  assert.equal(fsd.coveredBy, null, 'Faisalabad has no city page here')
  const school = topics.find((t) => t.school && t.city === 'Karachi' && !t.area)!
  assert.equal(school.coveredBy, null, 'a school-jobs search is not answered by a city page')
  const physics = topics.find((t) => t.side === 'parent' && t.queries.some((q) => q.query.includes('physics')))!
  assert.equal(physics.coveredBy?.path, '/tutors/lahore/o-levels-physics')
  // a published post with the same words and city covers it
  const withPost = buildSearchTopics(rows, { ...ctx, posts: [{ title: 'School teaching jobs in Karachi: a guide', slug: 'school-jobs-karachi', city: 'Karachi' }] })
  assert.equal(withPost.find((t) => t.school && t.city === 'Karachi' && !t.area)!.coveredBy?.path, '/blog/school-jobs-karachi')
})

test('no priority number on a topic or its candidate', () => {
  const topics = buildSearchTopics(rows, ctx)
  for (const t of topics) assert.ok(!('priority' in t))
  const c = searchTopicCandidate(topics[0])
  assert.ok(c.evidence.every((e) => !/priority/i.test(e)))
  assert.ok(c.evidence[0].includes('searches last month'))
  assert.ok(!/\d{2,}/.test(c.notes.replace(/“[^”]*”/g, '')), 'the notes handed to the writer carry no figures')
})

test('Queries CSV upload', () => {
  const ok = parseQueriesCsv('﻿Top queries,Clicks,Impressions,CTR,Position\n"jobs in lahore, female",16,102,15.7%,6.1\njobs,3,"1,040",0.3%,40\n')
  assert.ok(ok.ok)
  if (ok.ok) {
    assert.equal(ok.rows.length, 2)
    assert.equal(ok.rows[0].query, 'jobs in lahore, female')
    assert.equal(ok.rows[1].impressions, 1040)
  }
  const bad = parseQueriesCsv('Page,Clicks\n/x,1\n')
  assert.ok(!bad.ok)
})

test('Search Console access problems read plainly, with steps', () => {
  const perm = gscAccessProblem('User does not have sufficient permission for site', 'svc@x.iam.gserviceaccount.com')
  assert.ok(perm.steps.some((s) => s.includes('svc@x.iam.gserviceaccount.com')))
  assert.match(gscAccessProblem('Google Search Console API has not been used in project 1 before or it is disabled', null).summary, /switched off/)
})

test('the weekly email: 3 topics, "N searches last month", one plain line, no priority', () => {
  const topics = buildSearchTopics(rows, ctx)
  const items = digestItems(topics, [{ title: 'Site topic', searches: 4, audience: 'parents' }])
  assert.equal(items.length, 3)
  assert.ok(items.every((i) => i.searches > 0))
  const lines = digestLines(items, [])
  const text = lines.join('\n')
  assert.ok(!/priority/i.test(text))
  assert.equal((text.match(/searches last month\./g) ?? []).length, 3)
  // covered topics never go in the email
  assert.ok(!items.some((i) => i.title.startsWith('Female teaching jobs in Lahore')))
})

test('a queue draft is a DRAFT only, never published, with meta lengths held', () => {
  const row = draftRow({
    title: 'Teaching and tuition jobs in Faisalabad: how to find and apply',
    cluster: 'tutor-career',
    audience: 'tutors',
    city: 'Faisalabad',
    subject: null,
    body: '## One\n\nText',
    seoTitle: 'Teaching and tuition jobs in Faisalabad: how to find and apply for them today',
    seoDescription: 'x '.repeat(120),
    notes: '',
  })
  assert.equal(row.status, 'draft')
  assert.equal(row.reviewed, false)
  assert.equal(row.edited_by_human, false)
  assert.equal(row.approved_at, null)
  assert.equal(row.published_at, null)
  assert.ok((row.seo_title ?? '').length <= 60)
  assert.ok((row.seo_description ?? '').length <= 155)
  assert.equal(fitMetaTitle('short'), 'short')
  assert.ok(!fitMetaTitle('a'.repeat(30) + ' ' + 'b'.repeat(40)).includes('b'))
  // the drafter never publishes: no status other than draft is written
  const src = readFileSync('lib/blogQueueDraft.ts', 'utf8')
  assert.ok(!/status:\s*'published'|'scheduled'/.test(src))
})

test('the Live jobs block', () => {
  assert.equal(LIVE_JOBS_LIMIT, 6)
  assert.equal(parseLiveJobsLine('{{live-jobs}}'), null)
  assert.equal(parseLiveJobsLine('{{live-jobs:female}}'), 'female')
  assert.equal(parseLiveJobsLine('{{live-jobs:other}}'), undefined)
  const body = '## A\n\na\n\n## B\n\nb\n\n## C\n\nc\n\n## D\n\nd'
  const out = withLiveJobs(body)
  assert.ok(hasLiveJobs(out))
  assert.equal(withLiveJobs(out), out, 'never twice')
  assert.ok(out.indexOf('{{live-jobs}}') < out.indexOf('## C'))
  assert.equal(liveJobsAllHref('Lahore', 'female'), '/tuition-jobs/lahore/female')
  assert.equal(liveJobsAllHref(null, null), '/browse/tuitions')
  const parsed = parseMarkdown('Intro\n\n{{live-jobs:online}}\n\nMore')
  const seg = parsed.segments.find((s) => s.kind === 'embed')
  assert.ok(seg && seg.kind === 'embed' && seg.embed.type === 'live-jobs' && seg.embed.slug === 'online')
})

test('indexing order: fresh open first (newest first), then other open; never paused, closed, hidden or expired', () => {
  const now = Date.parse('2026-10-28T12:00:00Z')
  const day = 86_400_000
  const f = (status: string, ageDays: number, expired = false): NoticeFacts => ({ status, touchedMs: now - ageDays * day, expired })
  assert.equal(noticeSendable(f('paused', 1)), 'not_open')
  assert.equal(noticeSendable(f('closed', 1)), 'not_open')
  assert.equal(noticeSendable(f('hidden', 1)), 'not_open')
  assert.equal(noticeSendable(f('open', 25, true)), 'not_open')
  assert.equal(noticeTier(f('open', 2), now), 0)
  assert.equal(noticeTier(f('open', 10), now), 1)
  const n = (id: number, url: string): QueuedNotice => ({ id, url, kind: 'URL_UPDATED', created_at: '2026-10-20T00:00:00Z', priority: 0 })
  const facts = new Map<string, NoticeFacts>([
    ['u-old-open', f('open', 12)],
    ['u-fresh-1', f('open', 3)],
    ['u-fresh-2', f('open', 1)],
    ['u-mid-open', f('open', 9)],
  ])
  const plan = planDrain([n(1, 'u-old-open'), n(2, 'u-fresh-1'), n(3, 'u-fresh-2'), n(4, 'u-mid-open')], 0, 200, now, facts)
  assert.deepEqual(plan.send.map((x) => x.url), ['u-fresh-2', 'u-fresh-1', 'u-mid-open', 'u-old-open'])
  // touched = newest of posted / resumed / refreshed / bumped, and an edit notice
  assert.equal(touchedAt({ created_at: '2026-10-01T00:00:00Z', bumped_at: '2026-10-20T00:00:00Z' }), Date.parse('2026-10-20T00:00:00Z'))
  assert.equal(touchedAt({ created_at: '2026-10-01T00:00:00Z' }, { created_at: '2026-10-25T00:00:00Z', priority: 1 }), Date.parse('2026-10-25T00:00:00Z'))
  // the drain marks every not-open notice instead of sending it
  const src = readFileSync('lib/googleIndexing.ts', 'utf8')
  assert.match(src, /markSkipped\(admin, notOpen, 'not_open'\)/)
})

test('no noindex page in the sitemap: hubs below 3 or near-duplicates are left out; sitemap files are never cached at the edge', () => {
  const entries = hubSitemapEntries('https://www.tutormint.org', [
    { path: '/tuitions/karachi/grade-1-urdu', count: 2, threshold: 3 },
    { path: '/tuitions/karachi/grade-1-english', count: 5, threshold: 3, overlap: true },
    { path: '/tuitions/karachi/grade-2-english', count: 5, threshold: 3 },
  ])
  assert.deepEqual(entries.map((e) => e.url), ['https://www.tutormint.org/tuitions/karachi/grade-2-english'])
  for (const f of ['sitemap.xml', 'sitemap-pages.xml', 'sitemap-tuitions.xml', 'sitemap-tutors.xml', 'sitemap-blog.xml']) {
    const src = readFileSync(`app/${f}/route.ts`, 'utf8')
    assert.ok(!/s-maxage/.test(src), `${f} is not held at the edge`)
  }
  assert.match(readFileSync('scripts/check-internal-redirects.mjs', 'utf8'), /noindex page in the sitemap/)
})

test('no secrets in logs', () => {
  for (const f of ['lib/contentQueue/gsc.ts', 'lib/contentQueue/searchTopicsServer.ts', 'lib/blogQueueDraft.ts', 'lib/googleIndexing.ts', 'app/api/admin/blog/queue/draft/route.ts', 'app/api/admin/blog/queue/route.ts', 'app/api/internal/content-queue/route.ts']) {
    const src = readFileSync(f, 'utf8')
    for (const line of src.split('\n').filter((l) => /console\.(log|warn|error|info)/.test(l))) {
      // What is PRINTED: plain string literals are wording; only values passed
      // or interpolated count.
      const interpolated = (line.match(/\$\{[^}]*\}/g) ?? []).join(' ')
      const printed = line.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '') + ' ' + interpolated
      assert.ok(!/\bkey\b|private_key|creds|token|password|phone|email|cnic|iban|csv/i.test(printed), `${f}: ${line.trim()}`)
    }
  }
  // the draft audit row carries usage only — never post text
  const draft = readFileSync('lib/blogQueueDraft.ts', 'utf8')
  const detail = draft.slice(draft.indexOf("action: 'blog.draft_from_queue'"), draft.indexOf("status: 'draft',\n    },"))
  assert.ok(!/\b(body|title|notes|seoTitle|seoDescription|text):/.test(detail), 'no text field in the audit detail')
})
