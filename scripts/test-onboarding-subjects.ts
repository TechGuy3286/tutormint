import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { subjectGroups, filterMore } from '../lib/onboarding/subjectGroups'
import { stoppedAtLabel } from '../lib/onboardingStopCore'
import type { FlowFacts } from '../lib/tutorFlow'

// Hotfix, 7 Oct 2026 — simpler subject step in tutor onboarding + "Stopped at".

const tree = {
  Middle: {
    'Grade 6': ['Mathematics', 'English', 'Urdu', 'Computer', 'Art & Drawing'],
    'Grade 7': ['Mathematics', 'English', 'Urdu', 'Computer', 'Geography'],
    'Grade 8': ['Mathematics', 'English', 'Urdu', 'Computer', 'History'],
  },
  'Test Preparations': { 'Entry tests': ['MDCAT', 'ECAT', 'SAT'] },
}
const core = {
  Middle: { 'Grade 6': ['English', 'Mathematics', 'Urdu'], 'Grade 7': ['English', 'Mathematics', 'Urdu'], 'Grade 8': ['English', 'Mathematics', 'Urdu'] },
}

test('one main list per LEVEL, not one per grade', () => {
  const g = subjectGroups(tree, core, 'Middle')
  assert.deepEqual(g.main, ['English', 'Mathematics', 'Urdu'])
  assert.deepEqual(g.more, ['Art & Drawing', 'Computer', 'Geography', 'History'])
  assert.equal(g.noMain, false)
})

test('a picked non-main subject shows once, with the main chips, never in More', () => {
  const g = subjectGroups(tree, core, 'Middle', ['Computer'])
  assert.ok(g.main.includes('Computer'))
  assert.ok(!g.more.includes('Computer'))
})

test('a level with no main subjects opens straight to the full list', () => {
  const g = subjectGroups(tree, core, 'Test Preparations')
  assert.equal(g.noMain, true)
  assert.deepEqual(g.main, [])
  assert.deepEqual(g.more, ['ECAT', 'MDCAT', 'SAT'])
})

test('More search: substring OR the platform suggest names (Roman Urdu / typo)', () => {
  const more = ['Mathematics', 'Physics', 'Computer']
  assert.deepEqual(filterMore(more, ''), more)
  assert.deepEqual(filterMore(more, 'comp'), ['Computer'])
  assert.deepEqual(filterMore(more, 'hisab', ['Mathematics']), ['Mathematics'])
  assert.deepEqual(filterMore(more, 'fizics', ['Physics']), ['Physics'])
  assert.deepEqual(filterMore(more, 'xyz', []), [])
})

test('the subject step has no Select all and no second repeated list', () => {
  const src = readFileSync('components/tutor/NewOnboardingFlow.tsx', 'utf8')
  const step = src.slice(src.indexOf('function SubjectsStep('), src.indexOf('function FeeStep('))
  assert.ok(!/Select all/i.test(step))
  assert.ok(step.includes('More subjects'))
  assert.ok(step.includes('Need help? WhatsApp us'))
  assert.ok(step.includes('60_000'))
  // Still saves every grade of the level, in the same master-id shape.
  assert.ok(step.includes('resolveMasterIds(cat, Object.keys(tree[cat] ?? {}), subs)'))
})

const base: FlowFacts = {
  fullName: 'A', gender: 'female', city: 'Lahore', area: 'Gulberg', avatarUrl: null, headline: null, bio: null,
  experienceYears: null, hourlyRate: null, jobTypes: [], degreesCount: 0, degreeDocCount: 0, degrees: [],
  cnicNumber: null, cnicImagePath: null, subjectCount: 0, selfieDone: false, availabilityCount: 0,
  phoneVerified: true, whatsapp: null, feePaid: false, noDegreeYet: false, isSeed: false, isTeamAccount: false,
  isBanned: false, isSuspended: false, underReview: false, verificationStatus: null, imported: false, claimedAt: null,
}

test('Stopped at: the first unfinished step of the live onboarding', () => {
  assert.equal(stoppedAtLabel(base), 'Subjects')
  assert.equal(stoppedAtLabel({ ...base, gender: null }), 'Gender')
  assert.equal(stoppedAtLabel({ ...base, subjectCount: 3 }), 'Job type')
})
