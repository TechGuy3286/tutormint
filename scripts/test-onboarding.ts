/**
 * scripts/test-onboarding.ts
 *
 *   npm run test:onboarding
 *
 * The onboarding tagline/bio composer (lib/onboarding/copy.ts). PURE — it builds
 * text ONLY from the answers the tutor tapped, invents nothing, and picks a bio
 * pattern deterministically by hashing the tutor id so profiles do not all read
 * the same. The live counter and the tap UI rest on the build + a manual walk.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { composeHeadline, composeBio, type OnboardingAnswers } from '../lib/onboarding/copy'

const full: OnboardingAnswers = {
  city: 'Lahore',
  area: 'Johar Town',
  subjectNames: ['Physics', 'Chemistry'],
  levelNames: ['O Levels'],
  experienceBand: '3–5',
}

test('the headline is a natural phrase built from level + subject + city', () => {
  assert.equal(composeHeadline(full), 'O Levels Physics tutor in Lahore')
  assert.equal(
    composeHeadline({ ...full, levelNames: [] }),
    'Physics tutor in Lahore',
  )
  assert.equal(
    composeHeadline({ ...full, city: null, levelNames: [] }),
    'Physics tutor',
  )
  assert.equal(
    composeHeadline({ city: null, area: null, subjectNames: [], levelNames: [], experienceBand: null }),
    'Tutor',
  )
})

test('the bio is deterministic per seed and stable', () => {
  const a = composeBio(full, 'tutor-123')
  const b = composeBio(full, 'tutor-123')
  assert.equal(a, b, 'same seed must give the same bio')
  assert.ok(a.length > 10, 'bio should be a real sentence')
})

test('different tutors get different bios (no identical SEO text)', () => {
  // Across a spread of seeds, more than one distinct pattern is produced.
  const outputs = new Set(
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((s) => composeBio(full, `tutor-${s}`)),
  )
  assert.ok(outputs.size > 1, 'the composer must not produce one fixed bio for everyone')
})

test('the bio contains only facts the tutor gave — nothing invented', () => {
  const bio = composeBio(full, 'seed-x').toLowerCase()
  // The chosen subjects and place appear; a subject NOT chosen never does.
  assert.ok(bio.includes('physics') || bio.includes('chemistry'))
  assert.ok(!bio.includes('mathematics'), 'a subject the tutor did not tap must not appear')
  // The only digits allowed are the experience band the tutor chose ("3–5").
  const digits = bio.match(/\d+/g) ?? []
  for (const d of digits) assert.ok(['3', '5'].includes(d), `unexpected number in bio: ${d}`)
})

test('a bio with no experience band carries no numbers at all', () => {
  const bio = composeBio({ ...full, experienceBand: null }, 'seed-y')
  assert.equal(bio.match(/\d+/g), null, 'no numbers when no experience band was chosen')
})

test('an almost-empty answer set still composes a valid, honest bio', () => {
  const bio = composeBio(
    { city: null, area: null, subjectNames: [], levelNames: [], experienceBand: null },
    'seed-z',
  )
  assert.ok(bio.length > 0, 'never an empty bio')
  assert.ok(bio.includes('a range of subjects'), 'falls back to a non-specific, non-false phrase')
})
