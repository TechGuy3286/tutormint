/**
 * scripts/test-jobtitles.ts
 *
 *   npm run test:jobtitles
 *
 * Job Type is a set of 19 job titles stored as DATA (migration 77). The pure
 * rules the money and the matching hinge on — ordering, the online-is-city-
 * agnostic pivot, containment matching across the new set, the empty-array
 * "no filter" rule, the legacy value mapping, and the composed card title — are
 * unit-testable without the database (the DB round-trip itself is verified live).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { sortJobTitles, isOnlineTitle, keepKnownTitles, ONLINE_JOB_TITLE } from '../lib/jobTitlesCore'
import { jobDisplayTitle } from '../lib/jobDisplayTitle'
import { parseMode } from '../lib/locations'
import { matchVisibility } from '../lib/matchChip'
import { jobType } from '../lib/display'

// The 19, in the owner's exact order (test data — the app never hardcodes them).
const THE_19 = [
  'Home Tutor', 'Online Tutor', 'Early Years Teacher', 'Primary Teacher',
  'Middle School Teacher', 'High School Teacher', 'O Levels Teacher', 'A Levels Teacher',
  'IB PYP Teacher', 'IB MYP Teacher', 'IB Diploma Teacher', 'College Lecturer',
  'Visiting Teacher', 'Sports Teacher', 'Music Teacher', 'STEM Teacher',
  'Robotics Teacher', 'Vice Principal', 'Principal',
]

test('sortJobTitles keeps the owner order, from scrambled sort_order rows', () => {
  const rows = THE_19.map((name, i) => ({ name, sort_order: i + 1 }))
  // Scramble the input; the sort must restore the exact order.
  const scrambled = [...rows].reverse()
  assert.deepEqual(sortJobTitles(scrambled), THE_19)
})

test('every one of the 19 round-trips through the display layer verbatim', () => {
  // The stored value IS the label, so jobType() returns it unchanged — including
  // the acronym titles a title-caser would have mangled.
  for (const t of THE_19) {
    assert.equal(jobType(t), t, `jobType mangled "${t}"`)
  }
  // The ones most at risk from title-casing.
  assert.equal(jobType('IB PYP Teacher'), 'IB PYP Teacher')
  assert.equal(jobType('STEM Teacher'), 'STEM Teacher')
  assert.equal(jobType('O Levels Teacher'), 'O Levels Teacher')
})

test('isOnlineTitle points only at "Online Tutor" (item 6)', () => {
  assert.equal(ONLINE_JOB_TITLE, 'Online Tutor')
  assert.equal(isOnlineTitle('Online Tutor'), true)
  assert.equal(isOnlineTitle('online tutor'), true) // case-insensitive
  assert.equal(isOnlineTitle('Home Tutor'), false)
  assert.equal(isOnlineTitle('Robotics Teacher'), false)
  assert.equal(isOnlineTitle(null), false)
})

test('keepKnownTitles drops anything not in the curated set, order preserved', () => {
  assert.deepEqual(
    keepKnownTitles(['Home Tutor', 'garbage', 'STEM Teacher', 'home', ''], THE_19),
    ['Home Tutor', 'STEM Teacher'],
  )
  assert.deepEqual(keepKnownTitles([], THE_19), [])
})

test('containment matching works across the new set', () => {
  // A tutor whose set CONTAINS the job's title, same city → included.
  assert.equal(matchVisibility('O Levels Teacher', 'Lahore', ['O Levels Teacher', 'Home Tutor'], 'Lahore'), 'same_city')
  // A tutor who does NOT offer this title → excluded.
  assert.equal(matchVisibility('Principal', 'Lahore', ['Home Tutor', 'Online Tutor'], 'Lahore'), 'exclude')
  // "Online Tutor" is city-agnostic: cross-city online is a match (the chip).
  assert.equal(matchVisibility('Online Tutor', 'Lahore', ['Online Tutor'], 'Karachi'), 'online')
  // A HOME title cross-city is not a match, even when offered.
  assert.equal(matchVisibility('Home Tutor', 'Lahore', ['Home Tutor'], 'Karachi'), 'exclude')
})

test('an empty tutor array is "no filter" — every same-city job is a match (item 4)', () => {
  // The TYPE constraint is off for an empty set, so a job of any title in the
  // tutor's city is included rather than "matches nothing".
  for (const t of THE_19) {
    assert.equal(matchVisibility(t, 'Lahore', [], 'Lahore'), 'same_city', `empty set wrongly excluded "${t}"`)
    // Unknown tutor city → we cannot claim a mismatch, so included.
    assert.equal(matchVisibility(t, 'Lahore', [], null), 'same_city')
  }
  // The LOCATION rule still applies to an empty set: a home job in another city
  // is genuinely not a match; an online job in another city is.
  assert.equal(matchVisibility('Home Tutor', 'Lahore', [], 'Karachi'), 'exclude')
  assert.equal(matchVisibility('Online Tutor', 'Lahore', [], 'Karachi'), 'online')
})

test('the composed card title omits missing optional segments cleanly', () => {
  // All present: the full Job Title | Gender | Subject | Level | Area | City | Budget.
  assert.equal(
    jobDisplayTitle({
      jobType: 'O Levels Teacher', gender: 'Female', subject: 'Physics', level: 'O Levels',
      area: 'Gulberg', city: 'Lahore', budget: 'Rs 15,000–20,000',
    }),
    'O Levels Teacher | Female | Physics | O Levels | Gulberg | Lahore | Rs 15,000–20,000',
  )
  // Gender and budget missing → no stray pipes, no empty segments.
  assert.equal(
    jobDisplayTitle({ jobType: 'Home Tutor', subject: 'Maths', level: 'Grade 8', area: 'DHA', city: 'Karachi' }),
    'Home Tutor | Maths | Grade 8 | DHA | Karachi',
  )
  // Just the job type (everything else blank/missing).
  assert.equal(jobDisplayTitle({ jobType: 'Principal', gender: '', budget: null }), 'Principal')
  // Nothing at all → empty string.
  assert.equal(jobDisplayTitle({}), '')
})

test('parseMode maps legacy codes to titles and passes real titles through', () => {
  assert.equal(parseMode('home'), 'Home Tutor')
  assert.equal(parseMode('both'), 'Home Tutor')
  assert.equal(parseMode('in_person'), 'Home Tutor')
  assert.equal(parseMode('online'), 'Online Tutor')
  assert.equal(parseMode('remote'), 'Online Tutor')
  // 'school' is ambiguous now (17 school titles) — drop the filter, don't guess.
  assert.equal(parseMode('school'), null)
  // A real title from the select round-trips.
  assert.equal(parseMode('O Levels Teacher'), 'O Levels Teacher')
  assert.equal(parseMode(''), null)
  assert.equal(parseMode(null), null)
})
