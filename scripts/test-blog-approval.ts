import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  cadenceWarning,
  isoToPakistanLocal,
  needsReview,
  numberClaims,
  pakistanLocalToIso,
  pakistanWeek,
  postsInWeek,
  similarPosts,
  titleSkeleton,
} from '../lib/blogApproval'

// owner, 5 Oct 2026 — blog publishing settings (cadence, duplicates, numbers,
// review-by). Pure rules; the routes and pages read these.

test('the publishing week is Monday 00:00 Pakistan time', () => {
  // Wed 7 Oct 2026 10:00 PKT = 05:00Z
  const { start, end } = pakistanWeek(new Date('2026-10-07T05:00:00Z'))
  assert.equal(start.toISOString(), '2026-10-04T19:00:00.000Z') // Mon 5 Oct 00:00 PKT
  assert.equal(end.toISOString(), '2026-10-11T19:00:00.000Z')
  // Sunday 23:30 PKT is still the same week; Monday 00:30 PKT is the next.
  assert.equal(pakistanWeek(new Date('2026-10-11T18:30:00Z')).start.toISOString(), '2026-10-04T19:00:00.000Z')
  assert.equal(pakistanWeek(new Date('2026-10-11T19:30:00Z')).start.toISOString(), '2026-10-11T19:00:00.000Z')
})

test('posts in the week count published_at and scheduled publish_at; the third warns', () => {
  const at = new Date('2026-10-07T05:00:00Z')
  const posts = [
    { status: 'published', publishedAt: '2026-10-05T04:00:00Z', publishAt: null },
    { status: 'scheduled', publishedAt: null, publishAt: '2026-10-09T04:00:00Z' },
    { status: 'draft', publishedAt: null, publishAt: '2026-10-09T04:00:00Z' }, // not counted
    { status: 'published', publishedAt: '2026-09-30T04:00:00Z', publishAt: null }, // last week
  ]
  assert.equal(postsInWeek(posts, at), 2)
  assert.equal(cadenceWarning(2), null)
  assert.equal(cadenceWarning(3), 'Two posts a week works best for Google.')
})

test('schedule times are typed in Pakistan time and round-trip', () => {
  assert.equal(pakistanLocalToIso('2026-10-07T09:30'), '2026-10-07T04:30:00.000Z')
  assert.equal(isoToPakistanLocal('2026-10-07T04:30:00.000Z'), '2026-10-07T09:30')
  assert.equal(pakistanLocalToIso('nonsense'), null)
})

test('near-duplicate titles differ only by city, grade or subject', () => {
  const cities = ['Lahore', 'Islamabad', 'Karachi']
  const subjects = ['English', 'Physics', 'Mathematics']
  const a = 'Grade 9 & 10 - Science English tutors in Lahore: fees and how to choose'
  const b = 'Grade 9 & 10 - Science Physics tutors in Islamabad: fees and how to choose'
  assert.equal(titleSkeleton(a, cities, subjects), titleSkeleton(b, cities, subjects))
  const hits = similarPosts(a, [{ id: '2', title: b, slug: 'b' }, { id: '3', title: 'How TutorMint handles spam', slug: 'c' }], cities, subjects)
  assert.deepEqual(hits.map((h) => h.id), ['2'])
  // The same title is not "similar" to itself; a genuinely different title is not flagged.
  assert.equal(similarPosts(a, [{ id: '1', title: a, slug: 'a' }], cities, subjects).length, 0)
  assert.equal(similarPosts('Keeping messages useful', [{ id: '2', title: b, slug: 'b' }], cities, subjects).length, 0)
})

test('number claims: every Rs amount, percentage and tutor/tuition count', () => {
  const body =
    'A home tutor in Lahore charges Rs 8,000 to Rs. 15,000 a month. Around 60% of parents ask for a demo. ' +
    'We have 1,200 verified tutors and 300+ open tuitions. PKR 500 is typical. 25 percent more in DHA.'
  const claims = numberClaims(body)
  const texts = claims.map((c) => c.text)
  assert.ok(texts.includes('Rs 8,000'))
  assert.ok(texts.includes('Rs. 15,000'))
  assert.ok(texts.includes('60%'))
  assert.ok(texts.includes('25 percent'))
  assert.ok(texts.includes('1,200 verified tutors'))
  assert.ok(texts.includes('300+ open tuitions'))
  assert.ok(texts.includes('PKR 500'))
  assert.ok(claims.every((c) => c.context.length > 0))
  assert.equal(numberClaims('No figures here, typically affordable.').length, 0)
})

test('needs review after the Review-by date, Pakistan time', () => {
  assert.equal(needsReview('2026-11-30', new Date('2026-11-30T10:00:00Z')), false)
  assert.equal(needsReview('2026-11-30', new Date('2026-11-30T19:00:00Z')), true) // 1 Dec 00:00 PKT
  assert.equal(needsReview(null), false)
})
