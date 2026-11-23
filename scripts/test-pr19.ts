/**
 * scripts/test-pr19.ts — npm run test:pr19
 *
 * PR-19 (owner, 23 Nov 2026): gold rating stars everywhere, Applications date
 * chips, Applications page clean-up (How this works, Staff labels, Older rule).
 * Pure rules are exercised directly; the star component is rendered to HTML;
 * wiring is checked in the source.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import RatingStars from '../components/RatingStars'
import {
  NO_REVIEWS_YET,
  ratingAriaLabel,
  ratingFromStarBody,
  ratingText,
  starFills,
} from '../lib/ratingStarsCore'
import { feedbackNotice } from '../lib/demoFeedbackCore'
import {
  dueState,
  isNewUnseenApplication,
  isOlderApplication,
  isStaleApplied,
  STALE_APPLIED_DAYS,
  tabCounts,
  todoBadgeCount,
  type FollowUpRecord,
} from '../lib/applicationFollowUpCore'
import { DAY_MS, staffChoices, type Stage } from '../lib/applicationStageCore'
import { applicationsView, inAppsDate, parseAppsDate, parseAppsTab, withDue } from '../lib/applicationsPagingCore'
import { countRows, countSpan, type CountFacts } from '../lib/countsCore'
import { linkerMarks } from '../lib/tutorLinkersCore'
import type { CrawlTutor } from '../lib/tutorCrawlCore'

const read = (p: string) => readFileSync(p, 'utf8')
/** Source without comments, so a rule cannot pass on a comment. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

let passed = 0
async function t(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`  ok  ${name}`)
}

const html = (props: Parameters<typeof RatingStars>[0]) => renderToStaticMarkup(createElement(RatingStars, props))
const countOf = (s: string, re: RegExp) => (s.match(re) ?? []).length

// ------------------------------------------------------------ fixtures ----
// 23 Nov 2026, 00:30 Pakistan time = 22 Nov 19:30 UTC — just after midnight.
const NOW = Date.parse('2026-11-22T19:30:00Z')
const pk = (s: string) => new Date(Date.parse(`${s}+05:00`)).toISOString()
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const OWNER = { id: 'owner', adminRole: 'owner' }

type Row = {
  id: string
  jobId: string
  tutorId: string
  tutorName: string
  jobRef: string | null
  jobTitle: string
  jobCity: string | null
  stage: Stage
  stageChangedAt: string | null
  ownerId: string | null
  createdAt: string
  jobCreatedAt: string | null
  followUps: FollowUpRecord[]
}
const row = (id: string, createdAt: string, over: Partial<Row> = {}): Row => ({
  id,
  jobId: `j-${id}`,
  tutorId: `t-${id}`,
  tutorName: `Tutor ${id}`,
  jobRef: `TM-${id}`,
  jobTitle: 'Maths Tutor Required',
  jobCity: 'Lahore',
  stage: 'applied',
  stageChangedAt: createdAt,
  ownerId: 'aqsa',
  createdAt,
  jobCreatedAt: createdAt,
  followUps: [],
  ...over,
})
const fu = (applicationId: string, at: string, kind: FollowUpRecord['kind'] = 'follow_up', stage: Stage = 'applied'): FollowUpRecord => ({
  id: `fu-${applicationId}-${at}`,
  applicationId,
  stage,
  kind,
  recipient: 'parent',
  messageKey: 'share_profile',
  staffName: 'Aqsa',
  at,
})
const baseView = {
  nowMs: NOW,
  staffFilter: 'all',
  stageFilter: 'any' as const,
  tab: 'todo' as const,
  view: 'tuition' as const,
  q: '',
  shown: 2000,
  viewedShown: 25,
  forwardCards: [] as { jobId: string; state: { tab: string } }[],
  names: new Map([['aqsa', 'Aqsa'], ['nabeel', 'Nabeel']]),
  actor: OWNER,
}

async function main() {
  console.log('PR-19 Part A — gold rating stars')

  await t('star fills: full, half, empty (nearest half)', () => {
    assert.deepEqual(starFills(5), ['full', 'full', 'full', 'full', 'full'])
    assert.deepEqual(starFills(4.5), ['full', 'full', 'full', 'full', 'half'])
    assert.deepEqual(starFills(4.6), ['full', 'full', 'full', 'full', 'half'])
    assert.deepEqual(starFills(4.8), ['full', 'full', 'full', 'full', 'full'])
    assert.deepEqual(starFills(3), ['full', 'full', 'full', 'empty', 'empty'])
    assert.deepEqual(starFills(0.5), ['half', 'empty', 'empty', 'empty', 'empty'])
    assert.deepEqual(starFills('4.0'), ['full', 'full', 'full', 'full', 'empty'])
    assert.deepEqual(starFills(null), ['empty', 'empty', 'empty', 'empty', 'empty'])
    assert.deepEqual(starFills(9), starFills(5))
  })

  await t('text and accessible label: "5.0 (1 rating)", "4.6 (12 ratings)"', () => {
    assert.equal(ratingText(5, 1), '5.0 (1 rating)')
    assert.equal(ratingText(4.6, 12), '4.6 (12 ratings)')
    assert.equal(ratingText(4), '4.0')
    assert.equal(ratingAriaLabel(4.6, 12), 'Rated 4.6 out of 5 from 12 ratings')
    assert.equal(ratingAriaLabel(5, 1), 'Rated 5.0 out of 5 from 1 rating')
    assert.equal(ratingAriaLabel(4), 'Rated 4.0 out of 5')
    assert.equal(ratingAriaLabel(4, null, 'You rated'), 'You rated 4.0 out of 5')
  })

  await t('component: five stars always, gold filled, grey empty, half star, number + count, aria-label', () => {
    const h = html({ rating: 4.5, count: 12 })
    assert.equal(countOf(h, /data-star="/g), 5)
    assert.equal(countOf(h, /data-star="full"/g), 4)
    assert.equal(countOf(h, /data-star="half"/g), 1)
    assert.match(h, /fill-tm-star/)
    assert.match(h, /fill-gray-200/)
    assert.match(h, /role="img"/)
    assert.match(h, /aria-label="Rated 4.5 out of 5 from 12 ratings"/)
    assert.match(h, />4\.5</)
    assert.match(h, /\(12 ratings\)/)
    const one = html({ rating: 5, count: 1 })
    assert.equal(countOf(one, /data-star="full"/g), 5)
    assert.match(one, /\(1 rating\)/)
    const low = html({ rating: 2, count: 3 })
    assert.equal(countOf(low, /data-star="empty"/g), 3)
  })

  await t('component: no ratings → "No reviews yet", no empty stars; hideWhenNone → nothing', () => {
    const none = html({ rating: 0, count: 0 })
    assert.match(none, new RegExp(NO_REVIEWS_YET))
    assert.equal(countOf(none, /data-star=/g), 0)
    assert.equal(html({ rating: 0, count: 0, hideWhenNone: true }), '')
  })

  await t('component: one rating (no count) and "You rated"; a linked count keeps the link reachable', () => {
    const single = html({ rating: 4 })
    assert.match(single, /aria-label="Rated 4.0 out of 5"/)
    assert.doesNotMatch(single, /rating\)/)
    assert.match(html({ rating: 3, prefix: 'You rated' }), /aria-label="You rated 3.0 out of 5"/)
    const linked = html({ rating: 4.6, count: 12, countHref: '#reviews' })
    assert.doesNotMatch(linked, /role="img"/)
    assert.match(linked, /class="sr-only">Rated 4.6 out of 5 from 12 ratings</)
    assert.match(linked, /href="#reviews"/)
  })

  await t('the gold is #F5B301, a token (fill only) mirrored in lib/brand', () => {
    assert.match(read('app/globals.css'), /--color-tm-star: #f5b301;/)
    assert.match(read('lib/brand.ts'), /star: '#F5B301'/)
    assert.match(read('scripts/contrast-check.ts'), /tm-\(\?:gold\\b\(\?!-ink\)\|star\\b\)/)
  })

  await t('notification star line is drawn with the shared stars (stored text unchanged)', () => {
    const n = feedbackNotice(4, 'x')
    assert.deepEqual(ratingFromStarBody(n.body), { rating: 4, rest: '' })
    assert.equal(ratingFromStarBody('Your demo was accepted'), null)
    const bell = code('components/notifications/NotificationBell.tsx')
    assert.match(bell, /ratingFromStarBody\(body\)/)
    assert.match(bell, /<RatingStars rating=\{star\.rating\}/)
  })

  await t('used everywhere a rating appears; no hand-drawn ★ or local Stars left', () => {
    const sites = [
      'components/TutorCard.tsx', // Browse cards, city/subject + city tutor pages, blog embeds
      'app/(site)/tutor/[slug]/profile.tsx', // public profile: header, Reviews heading, each review
      'components/seo/RelatedTutorLinks.tsx', // Similar tutors + tuition pages' matching tutors
      'app/(site)/parent/dashboard/DemoInbox.tsx', // "You rated"
      'app/(site)/parent/dashboard/job/[jobId]/ApplicantList.tsx',
      'app/(site)/review/page.tsx',
      'components/notifications/NotificationBell.tsx',
      'app/admin/reviews/page.tsx', // Trust → Reviews
      'app/admin/users/[id]/page.tsx', // member page
      'app/admin/tutors/videos/TutorModerationClient.tsx',
    ]
    for (const f of sites) {
      const src = code(f)
      assert.match(src, /<RatingStars\b/, `${f} uses RatingStars`)
      assert.doesNotMatch(src, /★/, `${f} draws no ★ by hand`)
      assert.doesNotMatch(src, /function Stars\(/, `${f} has no local Stars`)
    }
    assert.doesNotMatch(code('components/TutorCard.tsx'), /name="star"/)
    assert.doesNotMatch(code('app/admin/reviews/page.tsx'), /fill-tm-gold/)
  })

  await t('Similar / matching tutor links carry the rating, and a rating change rebuilds their pages', () => {
    assert.match(code('lib/tutorCrawl.ts'), /rating_avg, rating_count/)
    assert.match(code('lib/publicRevalidate.ts'), /markRatingLinkers\(tutorId\)/)
    const a: CrawlTutor = { id: 'a', slug: 'a', name: 'A', city: 'Lahore', citySlug: 'lahore', gender: 'female', masters: [1], subjects: ['maths'], levels: ['o levels'] }
    const b: CrawlTutor = { ...a, id: 'b', slug: 'b' }
    const marks = linkerMarks([a, b], [a], [{ id: 'j', city: 'Lahore', publicSlug: 'maths-tutor', masters: [1], subjects: ['maths'], levels: ['o levels'], genderPref: null }]).map((m) => m.path)
    assert.ok(marks.includes('/tutor/b'), 'b lists a among its Similar tutors')
    assert.ok(marks.includes('/tuitions/lahore/maths-tutor'))
    assert.ok(marks.includes('/tutors/lahore') && marks.includes('/tutors/lahore/female'))
  })

  await t('no AggregateRating structured data', () => {
    for (const f of ['lib/seo.ts', 'app/(site)/tutor/[slug]/profile.tsx', 'components/RatingStars.tsx']) assert.doesNotMatch(code(f), /AggregateRating/)
  })

  console.log('\nPR-19 Part B — Applications date chips')

  await t('date windows in Pakistan time, across midnight', () => {
    // 00:30 PKT on 23 Nov: "Today" starts 00:00 PKT 23 Nov.
    assert.equal(inAppsDate(pk('2026-11-23T00:10:00'), 'today', NOW), true)
    assert.equal(inAppsDate(pk('2026-11-22T23:50:00'), 'today', NOW), false)
    assert.equal(inAppsDate(pk('2026-11-22T23:50:00'), 'yesterday', NOW), true)
    assert.equal(inAppsDate(pk('2026-11-22T00:00:00'), 'yesterday', NOW), true)
    assert.equal(inAppsDate(pk('2026-11-21T23:59:00'), 'yesterday', NOW), false)
    assert.equal(inAppsDate(pk('2026-11-17T00:00:00'), 'last7', NOW), true)
    assert.equal(inAppsDate(pk('2026-11-16T23:59:00'), 'last7', NOW), false)
    assert.equal(inAppsDate(pk('2026-11-01T00:00:00'), 'month', NOW), true)
    assert.equal(inAppsDate(pk('2026-10-31T23:59:00'), 'month', NOW), false)
    assert.equal(inAppsDate(pk('2020-01-01T00:00:00'), 'all', NOW), true)
    // The same instant as UTC would call it the 22nd: Pakistan time wins.
    assert.equal(new Date(NOW).toISOString().slice(0, 10), '2026-11-22')
  })

  await t('chip counts are the lib/counts "Applications" rule (same windows)', () => {
    const facts: CountFacts = {
      members: [{ id: 'tu1', role: 'tutor', createdAt: pk('2026-10-01T00:00:00'), phoneVerifiedAt: null, onboardedAt: null, excluded: null }],
      feePaid: [], plans: [], jobs: [], forwards: [], uploads: [], reveals: [],
      applications: [
        { id: 'x1', tutorId: 'tu1', createdAt: pk('2026-11-23T00:05:00') },
        { id: 'x2', tutorId: 'tu1', createdAt: pk('2026-11-22T23:55:00') },
        { id: 'x3', tutorId: 'tu1', createdAt: pk('2026-11-18T10:00:00') },
      ],
    }
    assert.equal(countRows('applications', facts, countSpan('today', NOW)).length, 1)
    assert.equal(countRows('applications', facts, countSpan('yesterday', NOW)).length, 1)
    assert.equal(countRows('applications', facts, countSpan('last7', NOW)).length, 3)
    const counts = code('lib/counts.ts')
    assert.match(counts, /export async function applicationDateCountsFresh/)
    assert.match(counts, /countRows\('applications', facts, countSpan\(p\.key, nowMs\)\)/)
    assert.match(code('app/admin/applications/page.tsx'), /applicationDateCounts\(now\)/)
    assert.match(code('scripts/check-counts.ts'), /screen: 'Applications date chips'/)
  })

  const rows: Row[] = [
    row('t1', pk('2026-11-23T00:10:00'), { ownerId: 'aqsa' }),
    row('t2', pk('2026-11-23T00:20:00'), { ownerId: 'nabeel', stage: 'forwarded', followUps: [fu('t2', pk('2026-11-23T00:21:00'), 'follow_up', 'forwarded')], stageChangedAt: pk('2026-11-23T00:21:00') }),
    row('y1', pk('2026-11-22T22:00:00'), { ownerId: 'aqsa', jobTitle: 'Physics Teacher' }),
    row('w1', pk('2026-11-19T10:00:00'), { ownerId: 'nabeel' }),
    row('m1', pk('2026-11-02T10:00:00'), { ownerId: 'aqsa' }), // Applied 20 days, no follow-up → Older
    row('o1', pk('2026-10-10T10:00:00'), { ownerId: null }), // last month → Older
  ]

  await t('date chip narrows tab counts, stage chips, Staff dropdown and the search', () => {
    const today = applicationsView({ ...baseView, rows, date: 'today' })
    assert.deepEqual(today.counts, { todo: 1, sent: 1, older: 0 })
    assert.equal(today.stageCounts.any, 1)
    assert.equal(today.stageCounts.applied, 1)
    assert.equal(today.choices.find((c) => c.key === 'all')?.count, 2)
    assert.equal(today.dateRowCount, 2)
    assert.equal(today.boardTotal, rows.length)
    const all = applicationsView({ ...baseView, rows })
    assert.equal(all.counts.todo + all.counts.sent + all.counts.older, rows.length)
    assert.equal(all.stageCounts.applied, 3) // t1, y1, w1 (m1 and o1 are Older)
    // Search inside a date chip.
    assert.equal(applicationsView({ ...baseView, rows, date: 'yesterday', q: 'physics' }).hitCount, 1)
    assert.equal(applicationsView({ ...baseView, rows, date: 'today', q: 'physics' }).hitCount, 0)
    // Staff filter + date + stage together.
    const mine = applicationsView({ ...baseView, rows, date: 'last7', staffFilter: 'aqsa', stageFilter: 'applied' })
    assert.deepEqual(mine.groups.rows.flatMap((g) => g.rows.map((r) => r.id)).sort(), ['t1', 'y1'])
    // By tutor view under a chip.
    const byTutor = applicationsView({ ...baseView, rows, date: 'last7', view: 'tutor' })
    assert.ok(byTutor.groups.rows.every((g) => g.rows.every((r) => r.tutorId === g.key)))
  })

  await t('within a date chip, newest applications first', () => {
    const many = [
      row('a', pk('2026-11-20T09:00:00'), { jobId: 'J1' }),
      row('b', pk('2026-11-21T09:00:00'), { jobId: 'J2' }),
      row('c', pk('2026-11-22T09:00:00'), { jobId: 'J1' }),
      row('d', pk('2026-11-19T09:00:00'), { jobId: 'J3' }),
    ]
    const v = applicationsView({ ...baseView, rows: many, date: 'last7' })
    assert.deepEqual(v.groups.rows.map((g) => g.key), ['J1', 'J2', 'J3'])
    assert.deepEqual(v.groups.rows[0].rows.map((r) => r.id), ['c', 'a'])
  })

  await t('the chip lives in the address (?date=), kept by every filter link and the search', () => {
    assert.equal(parseAppsDate('today'), 'today')
    assert.equal(parseAppsDate('last7'), 'last7')
    assert.equal(parseAppsDate('nonsense'), 'all')
    assert.equal(parseAppsDate(undefined), 'all')
    assert.equal(parseAppsTab('older'), 'older')
    assert.equal(parseAppsTab('x'), 'todo')
    const ui = code('app/admin/applications/ApplicationsClient.tsx')
    assert.match(ui, /if \(p\.date !== 'all'\) q\.set\('date', p\.date\)/)
    assert.match(ui, /date: date === 'all' \? undefined : date,/)
    assert.match(ui, /APPS_DATES\.map/)
  })

  console.log('\nPR-19 Part C — Applications clean-up')

  await t('"How this works" folds the explanation (same text) on phone and desktop', () => {
    const page = read('app/admin/applications/page.tsx')
    assert.match(page, /<HowThisWorks>/)
    assert.match(page, /The wording of every message is in Team inbox → Templates → Applications\./)
    assert.match(read('components/admin/HowThisWorks.tsx'), /<details[\s\S]*<summary[\s\S]*min-h-\[44px\]/)
  })

  await t('Staff dropdown says what it counts: "All staff · 907 applications"', () => {
    const ui = code('app/admin/applications/ApplicationsClient.tsx')
    assert.match(ui, /\{c\.label\} · \{plural\(c\.count\)\}/)
    assert.match(ui, /n === 1 \? 'application' : 'applications'/)
    const c = staffChoices(rows, new Map([['aqsa', 'Aqsa']]), OWNER)
    assert.equal(c[0].label, 'All staff')
    assert.equal(c[0].count, rows.length)
  })

  await t('Older rule: Applied > 14 days with no follow-up', () => {
    assert.equal(STALE_APPLIED_DAYS, 14)
    const fresh = row('f', ago(14 * DAY_MS - 60_000))
    const stale = row('s', ago(14 * DAY_MS + 60_000))
    assert.equal(isStaleApplied(fresh, [], NOW), false)
    assert.equal(isStaleApplied(stale, [], NOW), true)
    assert.equal(isStaleApplied(stale, [fu('s', ago(2 * DAY_MS))], NOW), false, 'a follow-up keeps it')
    assert.equal(isStaleApplied(stale, [fu('s', ago(2 * DAY_MS), 'tutor_update')], NOW), true, 'a tutor update is not a follow-up')
    assert.equal(isStaleApplied({ ...stale, stage: 'forwarded' }, [], NOW), false, 'only Applied')
    assert.equal(isOlderApplication(row('old', ago(DAY_MS), { jobCreatedAt: ago(31 * DAY_MS) }), [], NOW), true, '30-day tuitions stay Older')
    const d = dueState(stale, [], NOW)
    assert.equal(d.older, true)
    assert.equal(d.overdue, null)
  })

  await t('Older rows leave To do, the to-do badge and the new-applications badge; they keep their data', () => {
    const stale = row('s', ago(15 * DAY_MS), { ownerId: 'owner' })
    const fresh = row('f', ago(2 * DAY_MS), { ownerId: 'owner' })
    const w = withDue([stale, fresh], NOW)
    assert.deepEqual(tabCounts(w), { todo: 1, sent: 0, older: 1 })
    assert.equal(todoBadgeCount(w, OWNER), 1)
    // The new-unseen badge counts only 7 days anyway; an Older row is never in it.
    assert.equal(isNewUnseenApplication({ ...stale, createdAt: ago(3 * DAY_MS), jobCreatedAt: ago(3 * DAY_MS) }, [], NOW), true)
    assert.equal(isNewUnseenApplication(stale, [], NOW), false)
    const older = applicationsView({ ...baseView, rows: [stale, fresh], tab: 'older' })
    assert.equal(older.groups.rows.length, 1)
    assert.equal(older.groups.rows[0].rows[0].id, 's')
    assert.equal(older.groups.rows[0].rows[0].stage, 'applied')
    // Still forwardable: the forward button is drawn for every tuition group.
    assert.match(code('app/admin/applications/ApplicationsClient.tsx'), /\(\['todo', 'sent', 'older'\] as const\)/)
  })

  await t('a tutor with a scheduled erase is off the board, its badges and the Overview to-do (nothing written)', () => {
    const track = code('lib/applicationTracking.ts')
    assert.match(track, /from\('account_erasures'\)\.select\('id, member_id'\)\.eq\('status', 'scheduled'\)/)
    assert.match(track, /!applicantExcluded\(flagBy\.get\(a\.tutor_id\)\) && !eraseScheduled\.has\(a\.tutor_id\)/)
    const loader = track.slice(track.indexOf('async function loadCounted'), track.indexOf('const toItem'))
    assert.doesNotMatch(loader, /\.(update|insert|delete|upsert)\(/)
    assert.doesNotMatch(code('app/admin/applications/ApplicationsClient.tsx'), /data-date-note/)
  })

  await t('the Overview to-do and the badges read the same rule (dueState / isOlderApplication)', () => {
    const track = code('lib/applicationTracking.ts')
    assert.match(track, /due\.tab !== 'todo' \|\| due\.older \|\| !due\.overdue/)
    assert.match(code('lib/applicationFollowUpCore.ts'), /const older = isOlderApplication\(item, records, nowMs\)/)
    assert.match(code('lib/applicationFollowUpCore.ts'), /if \(isOlderApplication\(item, records, nowMs\)\) return false/)
    assert.match(code('scripts/check-counts.ts'), /overdueApplicationsItems\(\), newApplicationsItems\(\)/)
  })

  console.log(`\nPR-19: ${passed} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
