/**
 * scripts/test-social.ts
 *
 *   npm run test:social
 *
 * The pure rules of the social creatives (lib/social/copy.ts). The render module
 * imports next/og and cannot run under tsx, so the 12 combinations are proven by
 * the live smoke; these pin what must never regress:
 *   - the word "commission" appears EXACTLY ONCE on every template (the tagline);
 *   - the fixed brand band's text is present on every template;
 *   - the caption carries the tagline once, the profile URL, the handles and 5
 *     hashtags, and an announcement caption leads with the headline.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  SOCIAL_TEMPLATES,
  bandTextLines,
  buildCaption,
  hashtags,
  socialText,
  subjectLabels,
  teachingChip,
  TAGLINE,
  WORDMARK,
  SITE,
  HANDLE,
  X_HANDLE,
  type SocialData,
} from '../lib/social/copy'

function data(over: Partial<SocialData> = {}): SocialData {
  return {
    slug: 'ali-raza',
    name: 'Ali Raza',
    badges: ['Verified', 'Premium', 'Featured'],
    subjects: ['O Levels Physics', 'Matric Mathematics', 'IGCSE Chemistry'],
    ratingAvg: 4.9,
    ratingCount: 27,
    experienceYears: 5,
    teachingMode: 'both',
    city: 'Lahore',
    area: 'DHA Phase 5',
    profileUrl: 'https://www.tutormint.org/tutor/ali-raza',
    ...over,
  }
}

// ---- the single-"commission" rule -----------------------------------------

test('every template says "commission" exactly once — only in the tagline', () => {
  for (const template of SOCIAL_TEMPLATES) {
    const text = socialText(template, data({ headline: 'New verified tutors this month' })).join(' \n ').toLowerCase()
    const count = (text.match(/commission/g) ?? []).length
    assert.equal(count, 1, `${template}: expected 1 "commission", got ${count}`)
  }
})

// ---- the fixed band -------------------------------------------------------

test('the brand band text is present on every template', () => {
  const band = bandTextLines()
  assert.deepEqual(band, [WORDMARK, TAGLINE, SITE, HANDLE, X_HANDLE])
  for (const template of SOCIAL_TEMPLATES) {
    const lines = socialText(template, data())
    for (const b of band) assert.ok(lines.includes(b), `${template} band missing: ${b}`)
  }
})

// ---- subjects and the teaching chip ---------------------------------------

test('subjects show singular level labels, capped at three', () => {
  const labels = subjectLabels(['O Levels Physics', 'AS & A Levels Biology', 'Matric Math', 'IGCSE Chem'])
  assert.equal(labels.length, 3)
  assert.equal(labels[0], 'O Level Physics')
  assert.equal(labels[1], 'AS & A Level Biology')
})

test('the teaching chip follows the online rule', () => {
  assert.equal(teachingChip('both'), 'Suitable for online')
  assert.equal(teachingChip('online'), 'Suitable for online')
  assert.equal(teachingChip('in_person'), 'In person')
  assert.equal(teachingChip(null), null)
})

// ---- the caption ----------------------------------------------------------

test('the caption carries the tagline once, the URL, the handles and 5 hashtags', () => {
  const cap = buildCaption('spotlight', data())
  assert.equal((cap.match(/commission/g) ?? []).length, 1)
  assert.ok(cap.includes('https://www.tutormint.org/tutor/ali-raza'))
  assert.ok(cap.includes(HANDLE))
  assert.ok(cap.includes(X_HANDLE))
  const tags = hashtags(data())
  assert.equal(tags.length, 5)
  assert.ok(tags.includes('#TutorMint'))
  assert.ok(tags.includes('#LahoreTutors'))
  assert.ok(tags.includes('#PhysicsTutor'))
  assert.ok(cap.includes(tags.join(' ')))
})

test('an announcement caption leads with the headline', () => {
  const cap = buildCaption('announcement', data({ headline: 'Ten new verified tutors in Lahore' }))
  assert.ok(cap.startsWith('Ten new verified tutors in Lahore'))
})

test('hashtags always number five even with no city or subject', () => {
  assert.equal(hashtags(data({ city: null, subjects: [] })).length, 5)
})
