/**
 * scripts/test-tutorflow.ts
 *
 *   npm run test:tutorflow
 *
 * The gap-based tutor flow's pure brain (lib/tutorFlow): blockers come first,
 * each step's "done" test matches the facts, the flow opens at the first gap and
 * skips filled steps, and the final "You're listed" verdict is exactly
 * directoryBlockers being empty. The screens are not exercised here (no browser),
 * but the ordering and gap logic they hang on are.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  FLOW_ORDER,
  BLOCKER_STEPS,
  COMPLETION_KEY_TO_STEP,
  stepDone,
  missingSteps,
  firstMissingStep,
  nextMissingAfter,
  isListed,
  type FlowFacts,
} from '../lib/tutorFlow'
import { calculateTutorCompletion } from '../lib/profileChecklist'

// A fully-listed, fully-complete tutor.
const FULL: FlowFacts = {
  fullName: 'Sana', gender: 'female', city: 'Lahore', area: 'Gulberg',
  avatarUrl: 'https://x/a.jpg', headline: 'O Level Physics tutor', bio: 'I teach physics.',
  experienceYears: 3, hourlyRate: 15000, jobTypes: ['Home Tutor'], degreesCount: 1, degreeDocCount: 1,
  cnicNumber: '35201-1234567-1', cnicImagePath: 'p/cnic', subjectCount: 2, phoneVerified: true,
  feePaid: true, videoDone: true,
  isSeed: false, isTeamAccount: false, isBanned: false, isSuspended: false, underReview: false,
  verificationStatus: 'verified', imported: false, claimedAt: null,
}

// A brand-new tutor: nothing done except a name (set at signup).
const EMPTY: FlowFacts = {
  fullName: 'New Tutor', gender: null, city: null, area: null, avatarUrl: null, headline: null, bio: null,
  experienceYears: null, hourlyRate: null, jobTypes: [], degreesCount: 0, degreeDocCount: 0,
  cnicNumber: null, cnicImagePath: null, subjectCount: 0, phoneVerified: false, feePaid: false,
  videoDone: false, isSeed: false, isTeamAccount: false, isBanned: false, isSuspended: false,
  underReview: false, verificationStatus: 'pending', imported: false, claimedAt: null,
}

test('blockers come first, in the owner order (city, subjects, mobile, verify)', () => {
  assert.deepEqual(FLOW_ORDER.slice(0, 4), ['city', 'subjects', 'mobile', 'verify'])
  for (const k of ['city', 'subjects', 'mobile', 'verify'] as const) assert.ok(BLOCKER_STEPS.has(k))
  // The rest are not blockers.
  assert.ok(!BLOCKER_STEPS.has('jobtype'))
  assert.ok(!BLOCKER_STEPS.has('photo'))
})

test('a fully-complete tutor has no missing steps and is listed', () => {
  assert.deepEqual(missingSteps(FULL), [])
  assert.equal(firstMissingStep(FULL), null)
  assert.equal(isListed(FULL), true)
})

test('a brand-new tutor opens at city and misses everything but name', () => {
  assert.equal(firstMissingStep(EMPTY), 'city')
  assert.ok(!missingSteps(EMPTY).includes('name')) // name is set at signup
  assert.ok(missingSteps(EMPTY).includes('subjects'))
  assert.ok(missingSteps(EMPTY).includes('video'))
  assert.equal(isListed(EMPTY), false)
})

test('firstMissingStep skips filled steps — an existing tutor sees only her gaps', () => {
  // City + mobile done, everything else empty → first gap is subjects (not city).
  const f: FlowFacts = { ...EMPTY, city: 'Karachi', phoneVerified: true }
  assert.equal(firstMissingStep(f), 'subjects')
  // Fill subjects too → next gap is verify (still a blocker, before the rest).
  assert.equal(firstMissingStep({ ...f, subjectCount: 1 }), 'verify')
})

test('nextMissingAfter walks forward over filled steps', () => {
  // On the city step, city done → next missing is subjects.
  const f: FlowFacts = { ...EMPTY, city: 'Lahore' }
  assert.equal(nextMissingAfter(f, 'city'), 'subjects')
  // From the last step with nothing after → null.
  assert.equal(nextMissingAfter(FULL, 'video'), null)
})

test('stepDone matches the facts for each step', () => {
  assert.equal(stepDone({ ...EMPTY, city: '  ' }, 'city'), false) // blank is not done
  assert.equal(stepDone({ ...EMPTY, city: 'Lahore' }, 'city'), true)
  assert.equal(stepDone({ ...EMPTY, subjectCount: 1 }, 'subjects'), true)
  assert.equal(stepDone({ ...EMPTY, jobTypes: ['Home Tutor'] }, 'jobtype'), true)
  assert.equal(stepDone({ ...EMPTY, hourlyRate: 0 }, 'fee'), false) // 0 is not a fee
  assert.equal(stepDone({ ...EMPTY, hourlyRate: 8000 }, 'fee'), true)
  assert.equal(stepDone({ ...EMPTY, degreesCount: 1, degreeDocCount: 0 }, 'degree'), false) // needs both
  assert.equal(stepDone({ ...EMPTY, degreesCount: 1, degreeDocCount: 1 }, 'degree'), true)
  assert.equal(stepDone({ ...EMPTY, cnicNumber: '1', cnicImagePath: null }, 'cnic'), false)
})

test('the "You\'re listed" verdict is exactly directoryBlockers empty', () => {
  // PR16 §1 — visibility is mobile + subjects + city + area + gender (NO fee).
  const listable: FlowFacts = { ...EMPTY, city: 'Lahore', area: 'Gulberg', gender: 'female', subjectCount: 1, phoneVerified: true, feePaid: false, verificationStatus: 'pending' }
  assert.equal(isListed(listable), true, 'visible without the fee (PR16 §1)')
  // A seed fixture is never listed, whatever else is filled.
  assert.equal(isListed({ ...FULL, isSeed: true }), false)
  // Missing a city un-lists.
  assert.equal(isListed({ ...listable, city: null }), false)
})

test('every completion item maps to a flow step (§1.6 links never dead-end)', () => {
  const items = calculateTutorCompletion({}).items
  for (const it of items) {
    // The email item (PR29 §4) is fixed in Settings, not the gap flow — it is
    // added and confirmed by a link, not filled as a field — so checklistHref
    // routes it to Settings and it is the one item with no flow step.
    if (it.key === 'email') continue
    assert.ok(COMPLETION_KEY_TO_STEP[it.key], `completion item "${it.key}" has no flow step`)
    assert.ok(FLOW_ORDER.includes(COMPLETION_KEY_TO_STEP[it.key]), `"${it.key}" maps to an unknown step`)
  }
})
