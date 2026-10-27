/**
 * scripts/test-reviews.ts — parent reviews (owner, 27 Oct 2026): only a parent
 * whose application with the tutor is at Hired may review them, once per hire;
 * a review is pending until the Owner approves it; only approved reviews are
 * public and count in the rating; no review structured data; the approve API
 * answers 401 signed out. Invented data only.
 *   npm run test:reviews
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { countsInRating, ratingSummary, reviewEligibility, reviewInputProblem, REVIEW_ALREADY, REVIEW_NOT_HIRED } from '../lib/reviewsCore'
import { fillParentFollowUp, PARENT_DEFAULTS, PARENT_PLACEHOLDERS } from '../lib/parentFollowUpCore'

const read = (p: string) => readFileSync(p, 'utf8')
const PARENT = '11111111-1111-4111-8111-111111111111'
const TUTOR = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'
const hired = { stage: 'hired', status: 'applied', tutorId: TUTOR, jobParentId: PARENT }

test('only the parent who posted the tuition, with the application at Hired, may review', () => {
  assert.deepEqual(reviewEligibility(PARENT, hired, false), { ok: true })
  for (const stage of ['applied', 'forwarded', 'contacted', 'demo', 'not_selected', 'no_response']) {
    const r = reviewEligibility(PARENT, { ...hired, stage }, false)
    assert.equal(r.ok, false, stage)
    if (!r.ok) assert.equal(r.error, REVIEW_NOT_HIRED)
  }
  assert.equal(reviewEligibility(OTHER, hired, false).ok, false, 'another parent')
  assert.equal(reviewEligibility(PARENT, { ...hired, status: 'withdrawn' }, false).ok, false, 'a withdrawn application')
  assert.equal(reviewEligibility(PARENT, null, false).ok, false, 'no such application')
  assert.equal(reviewEligibility(TUTOR, { ...hired, jobParentId: TUTOR }, false).ok, false, 'never yourself')
})

test('once per hire', () => {
  const r = reviewEligibility(PARENT, hired, true)
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.status, 409)
    assert.equal(r.error, REVIEW_ALREADY)
  }
  const sql = read('supabase/migrations/204_reviews.sql')
  assert.match(sql, /create unique index if not exists reviews_application_uniq on public\.reviews \(application_id\)/)
  assert.match(sql, /public\.can_review_hire\(auth\.uid\(\), tutor_id, application_id\)/, 'the database checks the hire too')
  assert.match(sql, /a\.stage = 'hired'[\s\S]{0,120}j\.parent_id = p_parent/)
})

test('a 1–5 rating and a short text', () => {
  assert.equal(reviewInputProblem(5, 'Very patient and on time every week.'), null)
  assert.ok(reviewInputProblem(0, 'Very patient and on time every week.'))
  assert.ok(reviewInputProblem(6, 'Very patient and on time every week.'))
  assert.ok(reviewInputProblem(4.5, 'Very patient and on time every week.'))
  assert.ok(reviewInputProblem(4, 'Good'))
  assert.ok(reviewInputProblem(4, 'x'.repeat(601)))
})

test('saved pending; the Owner decides; only approved reviews count and are public', () => {
  const lib = read('lib/reviews.ts')
  assert.match(lib, /status: 'pending',/)
  assert.match(lib, /\.eq\('status', 'pending'\)\s*\.select\(/, 'decided once, only from pending')
  assert.match(lib, /action: decision === 'approve' \? 'review\.approve' : 'review\.reject'/, 'logged in Audit')
  const route = read('app/api/admin/reviews/decide/route.ts')
  assert.match(route, /checkAdminRole\(\.\.\.SCREEN_ACCESS\.reviews\)/)
  assert.match(route, /refuseUnlessOwnerApproval\(gate\.actor/)
  assert.ok(route.indexOf('refuseUnlessOwnerApproval') < route.indexOf('decideReview('), 'refused before anything is written')
  assert.match(read('app/admin/reviews/ReviewDecision.tsx'), /useCanApprove\(\)/)
  // A parent cannot insert an approved review, nor approve their own.
  const sql = read('supabase/migrations/204_reviews.sql')
  assert.match(sql, /and status = 'pending'\s*and decided_by is null/)
  assert.doesNotMatch(sql, /for update/i)
  // Public reads and the rating: approved only.
  assert.match(sql, /using \(status = 'approved' or parent_id = auth\.uid\(\) or public\.is_admin\(\)\)/)
  assert.match(sql, /r\.rating is not null and r\.status = 'approved'/)
  assert.match(sql, /where r\.tutor_id = d\.id and r\.status = 'approved'/, 'tutor_public_page lists approved only')
  assert.match(read('app/(site)/tutor/[slug]/page.tsx'), /\.eq\('status', 'approved'\)/, 'the owner preview too')
  assert.equal(countsInRating('approved'), true)
  assert.equal(countsInRating('pending'), false)
  assert.equal(countsInRating('rejected'), false)
  assert.deepEqual(
    ratingSummary([
      { rating: 5, status: 'approved' },
      { rating: 1, status: 'pending' },
      { rating: 1, status: 'rejected' },
      { rating: 4, status: 'approved' },
    ]),
    { avg: 4.5, count: 2 },
  )
})

test('Reviews sits under Trust; signed out the approve API is 401 and /review shows a sign-in prompt', () => {
  assert.match(read('lib/adminNav.ts'), /\{ href: '\/admin\/reviews', label: 'Reviews', icon: 'star', screen: 'reviews' \}/)
  const nav = read('lib/adminNav.ts')
  const trust = nav.slice(nav.indexOf("title: 'Trust'"), nav.indexOf("title: 'Growth'"))
  assert.ok(trust.includes("'/admin/reviews'"))
  // checkAdminRole answers 401 to a request with no session.
  assert.match(read('lib/adminAuth.ts'), /status: 401/)
  const page = read('app/(site)/review/page.tsx')
  assert.match(page, /href=\{`\/login\?next=\$\{encodeURIComponent\(back\)\}`\}/)
  assert.match(read('app/api/reviews/route.ts'), /status: 401/)
  assert.doesNotMatch(page, /Sir Bilal|JOB-TM-4821|TM-8821/, 'no invented sample on the page')
})

test('no review structured data anywhere', () => {
  for (const f of ['lib/seo.ts', 'app/(site)/tutor/[slug]/page.tsx', 'app/(site)/review/page.tsx', 'app/admin/reviews/page.tsx']) {
    assert.doesNotMatch(read(f), /aggregateRating|"@type":\s*"Review"|'@type': 'Review'/, f)
  }
})

test('the "Tutor hired" message carries the review link', () => {
  assert.ok((PARENT_PLACEHOLDERS as readonly string[]).includes('review_link'))
  assert.match(PARENT_DEFAULTS.pf_hired, /\{review_link\}/)
  const text = fillParentFollowUp(PARENT_DEFAULTS.pf_hired, {
    firstName: 'Ayesha',
    tutorName: 'Sara Example',
    postLink: 'https://www.tutormint.org/parent/dashboard/post-job',
    reviewLink: 'https://www.tutormint.org/review?application=44444444-4444-4444-8444-444444444444',
    supportWhatsapp: '0300 0000000',
  })
  assert.match(text, /\nhttps:\/\/www\.tutormint\.org\/review\?application=44444444-4444-4444-8444-444444444444\n/)
  assert.doesNotMatch(text, /\{[a-z_]+\}/)
  // One builder for every parent WhatsApp button (owner, 27 Oct 2026).
  assert.match(read('lib/parentWhatsApp.ts'), /reviewLink: tuition\?\.hiredApplicationId \? siteLink\(`\/review\?application=/)
  assert.match(read('supabase/migrations/204_reviews.sql'), /where key = 'pf_hired'\s*and body = E'/, 'only the untouched stored wording is updated')
})
