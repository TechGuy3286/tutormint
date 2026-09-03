/**
 * scripts/test-jobcopy.ts
 *
 * Unit tests for the job-advert composer and, more importantly, the verifier
 * that decides whether generated copy may be shown to a parent at all.
 *
 *   npm run test:jobcopy
 *
 * Uses node:test, like scripts/test-delivery.ts — the repo has no test
 * framework and adding one for a dozen assertions would be a heavier decision
 * than the tests justify.
 *
 * WHAT IS AND IS NOT PROVEN HERE. These tests assert the two things that do
 * not depend on the network: that the composed fallback says only what was
 * selected, and that `unsupportedFacts` catches a figure nobody chose while
 * leaving the selected ones alone. They do NOT prove Claude writes good copy —
 * that needs ANTHROPIC_API_KEY and a live call. The distinction matters,
 * because the verifier is the part that has to hold when the model is having
 * an imaginative day, and it is the part that can be tested for free.
 *
 * They import from lib/ai/jobBrief.ts rather than lib/ai/jobCopy.ts, which is
 * exactly why that split exists: jobCopy reaches the API through a module that
 * imports 'server-only' and refuses to load in a test runner.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { composeJobCopy, unsupportedFacts, type JobSelection } from '../lib/ai/jobBrief'

/** One real selection set: what the form sends for one pass through the taps. */
const SELECTION: JobSelection = {
  level: 'O Levels',
  subjects: ['Physics', 'Mathematics'],
  city: 'Lahore',
  area: 'DHA Phase 5',
  mode: 'in_person',
  budgetMin: 10000,
  budgetMax: 19999,
  schedule: 'Weekdays, Evenings',
}

const NO_BUDGET: JobSelection = {
  ...SELECTION,
  budgetMin: null,
  budgetMax: null,
  schedule: null,
}

// ------------------------------------------------------------- composer ----

test('the composed fallback invents no figure', () => {
  const c = composeJobCopy(SELECTION)
  assert.deepEqual(unsupportedFacts(`${c.title} ${c.description}`, SELECTION), [])
  assert.equal(c.source, 'composed')
})

test('the composed fallback carries every selection it was given', () => {
  const c = composeJobCopy(SELECTION)
  for (const fact of ['Physics', 'Mathematics', 'O Levels', 'DHA Phase 5', 'Lahore', 'in person']) {
    assert.ok(c.description.includes(fact), `missing: ${fact}`)
  }
  assert.match(c.description, /Rs 10,000 - 20,000/)
})

test('the composed fallback is silent about what was NOT selected', () => {
  const c = composeJobCopy(NO_BUDGET)
  // \b so this does not match the "rs" inside "person" — an earlier version of
  // this assertion did, and reported a bug that was not there.
  assert.doesNotMatch(c.description, /\bRs\b|\bbudget\b/i)
  assert.doesNotMatch(c.description, /weekday|evening|morning/i)
})

// ------------------------------------------------------------- verifier ----
//
// Each case is text a model could plausibly return for this selection set.
// The invented ones are the classes of invention that would actually embarrass
// a parent: a child's exam result, a fee nobody offered, a commitment nobody
// made, a child's age.

test('clean copy passes the verifier', () => {
  const text =
    'We are looking for an O Levels Physics and Mathematics tutor in DHA Phase 5, Lahore. ' +
    'We would like lessons in person on weekdays in the evenings. Our monthly budget is Rs 10,000 - 20,000.'
  assert.deepEqual(unsupportedFacts(text, SELECTION), [])
})

test('an invented exam result is caught', () => {
  const text = 'Our son is currently getting a C and we need him at an A. He scored 62% in his mocks.'
  assert.deepEqual(unsupportedFacts(text, SELECTION), ['62'])
})

test('an invented budget is caught', () => {
  const text = 'We can pay around Rs 30,000 a month for the right person.'
  assert.deepEqual(unsupportedFacts(text, NO_BUDGET), ['30,000'])
})

test('an invented commitment is caught', () => {
  const text = 'We would like 3 sessions a week, 2 hours each.'
  assert.deepEqual(unsupportedFacts(text, NO_BUDGET), ['3', '2'])
})

test("an invented age for the parent's child is caught", () => {
  assert.deepEqual(unsupportedFacts('Our daughter is 14 and enjoys the subject.', NO_BUDGET), ['14'])
})

test('figures inside a selected level name are not flagged', () => {
  const sel: JobSelection = { ...NO_BUDGET, level: 'Grade 9 & 10 - Science' }
  assert.deepEqual(unsupportedFacts('We need a tutor for Grade 9 & 10 - Science in Lahore.', sel), [])
})

test('the budget band written the readable way is not flagged', () => {
  // The band is stored as 10000/19999 and reads as "Rs 10,000 - 20,000". A
  // digits-only scan of the label yields "10","000","20","000", which matches
  // nothing in an output that writes "20,000" — this is the case that caught
  // that bug.
  assert.deepEqual(unsupportedFacts('Our budget is Rs 10,000 - 20,000 per month.', SELECTION), [])
})

test('a number inside a selected area is not flagged', () => {
  assert.deepEqual(unsupportedFacts('We are in DHA Phase 5, Lahore.', SELECTION), [])
})
