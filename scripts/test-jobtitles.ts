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
import { jobDisplayTitle, preferHumanTitle } from '../lib/jobDisplayTitle'
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

test('the composed card title reads as a natural phrase (owner, 13 Sep)', () => {
  // The full example from the PR, composed exactly:
  //   [Gender] [Job Title] for [Level] in [Area], [City]
  assert.equal(
    jobDisplayTitle({
      jobType: 'Home Tutor', gender: 'female', level: 'Grade 1–5',
      area: 'Johar Town', city: 'Lahore',
    }),
    'Female Home Tutor for Grade 1–5 in Johar Town, Lahore',
  )
  // Gender is capitalised as an adjective even when handed in lowercase, and
  // omitted entirely for No preference — never lowercase mid-sentence.
  assert.equal(
    jobDisplayTitle({ jobType: 'Home Tutor', gender: null, level: 'Grade 8', area: 'DHA', city: 'Karachi' }),
    'Home Tutor for Grade 8 in DHA, Karachi',
  )
  // No area → "in <City>" with no stray comma.
  assert.equal(
    jobDisplayTitle({ jobType: 'O Levels Teacher', gender: 'male', level: 'O Levels', city: 'Lahore' }),
    'Male O Levels Teacher for O Levels in Lahore',
  )
  // Non-contiguous levels read naturally (the caller passes the "and" list).
  assert.equal(
    jobDisplayTitle({ jobType: 'Home Tutor', level: 'Grade 2 and Grade 5', city: 'Lahore' }),
    'Home Tutor for Grade 2 and Grade 5 in Lahore',
  )
  // Only a title and a city → no stray "for", no dangling preposition.
  assert.equal(jobDisplayTitle({ jobType: 'Home Tutor', city: 'Lahore' }), 'Home Tutor in Lahore')
  // Nothing at all → empty string.
  assert.equal(jobDisplayTitle({}), '')
})

test('the composed title never carries subjects or a budget', () => {
  // The type no longer accepts them, but even a stray value must not surface:
  // the phrase is built only from gender/title/level/area/city.
  const title = jobDisplayTitle({
    jobType: 'Home Tutor', gender: 'female', level: 'Grade 1–5',
    area: 'Johar Town', city: 'Lahore',
  })
  for (const banned of ['English', 'Mathematics', 'Urdu', 'Rs', '20,000', '|']) {
    assert.ok(!title.includes(banned), `title leaked "${banned}": ${title}`)
  }
})

test('page surfaces use the stored human headline, card uses the composed phrase (owner, 11 Sep)', () => {
  // The SAME job: the card shows the composed phrase; the page <title> and
  // JobPosting show the human-written headline the form produced.
  const composed = jobDisplayTitle({
    jobType: 'Primary Teacher', gender: 'female', level: 'Grade 3',
    area: 'Gulberg', city: 'Lahore',
  })
  const stored = 'Primary Maths teacher needed in Gulberg, Grade 3'
  // Card keeps the composed phrase.
  assert.equal(composed, 'Female Primary Teacher for Grade 3 in Gulberg, Lahore')
  // Page prefers the stored headline over the composed phrase.
  assert.equal(preferHumanTitle(stored, composed), stored)
})

test('an empty stored title falls back to the composed phrase on the page', () => {
  const composed = 'Home Tutor in Lahore'
  assert.equal(preferHumanTitle('', composed), composed)
  assert.equal(preferHumanTitle('   ', composed), composed)
  assert.equal(preferHumanTitle(null, composed), composed)
  assert.equal(preferHumanTitle(undefined, composed), composed)
  // A real stored title (with surrounding space) is trimmed and preferred.
  assert.equal(preferHumanTitle('  Early Years Teacher Required  ', composed), 'Early Years Teacher Required')
})

test('the two corrected school jobs match tutors who selected those titles', () => {
  // JOB-TX-5MCHM5U -> Early Years Teacher, JOB-TX-M6MXVCD -> Primary Teacher.
  assert.equal(matchVisibility('Early Years Teacher', 'Lahore', ['Early Years Teacher'], 'Lahore'), 'same_city')
  assert.equal(matchVisibility('Primary Teacher', 'Lahore', ['Primary Teacher', 'Home Tutor'], 'Lahore'), 'same_city')
  // A tutor who did not select the title is not matched.
  assert.equal(matchVisibility('Early Years Teacher', 'Lahore', ['Home Tutor'], 'Lahore'), 'exclude')
  // Both are location-bound (not online), so a different city excludes.
  assert.equal(matchVisibility('Primary Teacher', 'Lahore', ['Primary Teacher'], 'Karachi'), 'exclude')
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
