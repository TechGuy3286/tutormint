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
  experienceYears: 3, hourlyRate: 15000, jobTypes: ['Home Tutor'], degreesCount: 1, degreeDocCount: 1, degrees: ['BSc Physics'],
  cnicNumber: '35201-1234567-1', cnicImagePath: 'p/cnic', subjectCount: 2, selfieDone: true, availabilityCount: 1, phoneVerified: true,
  whatsapp: '923001234567', feePaid: true, noDegreeYet: false,
  isSeed: false, isTeamAccount: false, isBanned: false, isSuspended: false, underReview: false,
  verificationStatus: 'verified', imported: false, claimedAt: null,
}

// A brand-new tutor: nothing done except a name (set at signup).
const EMPTY: FlowFacts = {
  fullName: 'New Tutor', gender: null, city: null, area: null, avatarUrl: null, headline: null, bio: null,
  experienceYears: null, hourlyRate: null, jobTypes: [], degreesCount: 0, degreeDocCount: 0, degrees: [],
  cnicNumber: null, cnicImagePath: null, subjectCount: 0, selfieDone: false, availabilityCount: 0, phoneVerified: false,
  whatsapp: null, feePaid: false,
  noDegreeYet: false,
  isSeed: false, isTeamAccount: false, isBanned: false, isSuspended: false,
  underReview: false, verificationStatus: 'pending', imported: false, claimedAt: null,
}

test('PR86: the contact step requires a WhatsApp number', () => {
  // FULL has one → contact is done.
  assert.equal(stepDone(FULL, 'contact'), true)
  // Remove it → contact is no longer done (surfaces step 7). Not a listing gate.
  const noWa = { ...FULL, whatsapp: null }
  assert.equal(stepDone(noWa, 'contact'), false)
  assert.equal(isListed(noWa), true) // WhatsApp does NOT block listing
})

test('the flow follows the owner order with the platform fee last (PR78 §C)', () => {
  assert.deepEqual(FLOW_ORDER, [
    'city', 'area', 'level', 'subjects', 'jobtype', 'availability',
    'name', 'contact',
    'degree', 'experience', 'fee', 'photo', 'selfie', 'cnic', 'verify',
  ])
  // The platform fee moves to LAST — everything is answered before paying.
  assert.equal(FLOW_ORDER[FLOW_ORDER.length - 1], 'verify')
  // Step 7 "Contact and about you" is ONE screen (PR78 §C) — the old separate
  // mobile / gender / tagline / bio steps are gone.
  for (const k of ['mobile', 'gender', 'tagline', 'bio', 'video'] as const) {
    assert.ok(!(FLOW_ORDER as string[]).includes(k), `${k} should not be its own step`)
  }
  // Mobile verification is still a listing blocker — now via the 'contact' step.
  for (const k of ['city', 'level', 'subjects', 'contact', 'verify'] as const) assert.ok(BLOCKER_STEPS.has(k))
  assert.ok(!BLOCKER_STEPS.has('jobtype'))
  assert.ok(!BLOCKER_STEPS.has('photo'))
})

test('the contact step needs mobile + WhatsApp + gender + tagline + bio; email optional (PR78 §C / PR86)', () => {
  const base: FlowFacts = { ...EMPTY, phoneVerified: true, whatsapp: '923001234567', gender: 'female', headline: 'x', bio: 'y' }
  assert.equal(stepDone(base, 'contact'), true)
  assert.equal(stepDone({ ...base, phoneVerified: false }, 'contact'), false)
  assert.equal(stepDone({ ...base, whatsapp: null }, 'contact'), false) // PR86: WhatsApp required
  assert.equal(stepDone({ ...base, gender: null }, 'contact'), false)
  assert.equal(stepDone({ ...base, headline: null }, 'contact'), false)
  assert.equal(stepDone({ ...base, bio: '  ' }, 'contact'), false)
})

test('degree is answered by a typed degree OR "No degree to add yet" — certificate optional (PR106-A §4)', () => {
  assert.equal(stepDone({ ...EMPTY, degreesCount: 1, degreeDocCount: 1 }, 'degree'), true)
  assert.equal(stepDone({ ...EMPTY, noDegreeYet: true }, 'degree'), true)
  // PR106-A: a typed degree with NO certificate is now enough.
  assert.equal(stepDone({ ...EMPTY, degreesCount: 1, degreeDocCount: 0, noDegreeYet: false }, 'degree'), true)
  // Nothing typed and no "none yet" answer → still not done.
  assert.equal(stepDone({ ...EMPTY, degreesCount: 0, degreeDocCount: 0, noDegreeYet: false }, 'degree'), false)
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
  assert.equal(isListed(EMPTY), false)
})

test('firstMissingStep skips filled steps — an existing tutor sees only her gaps', () => {
  // City done, everything else empty → first gap is area (2nd in the order).
  const f: FlowFacts = { ...EMPTY, city: 'Karachi', phoneVerified: true }
  assert.equal(firstMissingStep(f), 'area')
  // Fill the preference run (area, level+subjects, jobtype, availability) → the
  // first gap is now the contact step (name is already set at signup; gender/
  // tagline/bio are still missing, so contact is not done).
  const g: FlowFacts = { ...f, area: 'Saddar', subjectCount: 1, jobTypes: ['Home Tutor'], availabilityCount: 1 }
  assert.equal(firstMissingStep(g), 'contact')
})

test('nextMissingAfter walks forward over filled steps', () => {
  // On the city step, city done → next missing is area (2nd in the order).
  const f: FlowFacts = { ...EMPTY, city: 'Lahore' }
  assert.equal(nextMissingAfter(f, 'city'), 'area')
  // From the last step ('verify') with nothing after → null.
  assert.equal(nextMissingAfter(FULL, 'verify'), null)
})

test('stepDone matches the facts for each step', () => {
  assert.equal(stepDone({ ...EMPTY, city: '  ' }, 'city'), false) // blank is not done
  assert.equal(stepDone({ ...EMPTY, city: 'Lahore' }, 'city'), true)
  assert.equal(stepDone({ ...EMPTY, subjectCount: 1 }, 'subjects'), true)
  assert.equal(stepDone({ ...EMPTY, jobTypes: ['Home Tutor'] }, 'jobtype'), true)
  assert.equal(stepDone({ ...EMPTY, hourlyRate: 0 }, 'fee'), false) // 0 is not a fee
  assert.equal(stepDone({ ...EMPTY, hourlyRate: 8000 }, 'fee'), true)
  assert.equal(stepDone({ ...EMPTY, degreesCount: 1, degreeDocCount: 0 }, 'degree'), true) // PR106-A: certificate optional
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
