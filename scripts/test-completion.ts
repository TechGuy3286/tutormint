/**
 * scripts/test-completion.ts — npm run test:completion
 *
 * The contact-email completion item: a real (non-synthetic) email counts for a
 * PARENT, a synthetic <msisdn>@users.tutormint.org does not, and the item's link
 * goes to Settings. A TUTOR has NO email item at all (owner hotfix, 5 Oct 2026):
 * email is optional in onboarding and the percentage never depends on it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  calculateTutorCompletion,
  calculateParentCompletion,
  checklistHref,
  hasRealEmail,
  type ChecklistItem,
} from '../lib/profileChecklist'

const REAL = 'aqsa@example.com'
const SYNTH = '923001234567@users.tutormint.org'

test('hasRealEmail: real yes, synthetic no, empty no', () => {
  assert.equal(hasRealEmail(REAL), true)
  assert.equal(hasRealEmail(SYNTH), false)
  assert.equal(hasRealEmail(''), false)
  assert.equal(hasRealEmail(null), false)
  assert.equal(hasRealEmail(undefined), false)
})

function emailItem(items: ChecklistItem[]): ChecklistItem {
  const it = items.find((i) => i.key === 'email')
  assert.ok(it, 'an email item exists in the checklist')
  return it!
}

// Everything a tutor can fill, with NO email anywhere.
const FULL_TUTOR = {
  profile: { full_name: 'Aqsa', city: 'Lahore', cnic_number: '3520212345671', cnic_image_path: 'set', phone_verified_at: 'set', email: SYNTH },
  tutorProfile: {
    gender: 'female', area: 'Gulberg', avatar_url: 'set', headline: 'Tutor', bio: 'About me',
    experience_years: 3, hourly_rate_pkr: 8000, job_types: ['Home Tutor'], degrees: ['BSc'],
  },
  subjectCount: 2,
  feePaid: true,
}

test('tutor: there is NO email item — 15 items, and email never changes the %', () => {
  const noEmail = calculateTutorCompletion(FULL_TUTOR)
  assert.equal(noEmail.items.length, 15)
  assert.equal(noEmail.items.some((i) => i.key === 'email'), false)
  assert.equal(noEmail.percent, 100, 'a complete tutor with only a synthetic email is 100%')
  const withEmail = calculateTutorCompletion({ ...FULL_TUTOR, profile: { ...FULL_TUTOR.profile, email: REAL } })
  assert.equal(withEmail.percent, 100, 'adding a real email changes nothing')
  // A single missing item is the same % with or without an email on file.
  const noBio = calculateTutorCompletion({ ...FULL_TUTOR, tutorProfile: { ...FULL_TUTOR.tutorProfile, bio: '' } })
  const noBioEmail = calculateTutorCompletion({ ...FULL_TUTOR, profile: { ...FULL_TUTOR.profile, email: REAL }, tutorProfile: { ...FULL_TUTOR.tutorProfile, bio: '' } })
  assert.equal(noBio.percent, noBioEmail.percent)
  assert.equal(noBio.percent, 93)
})

test('parent: email item done with a real email, not with a synthetic one', () => {
  assert.equal(emailItem(calculateParentCompletion({ profile: { email: REAL } }).items).done, true)
  assert.equal(emailItem(calculateParentCompletion({ profile: { email: SYNTH } }).items).done, false)
})

test('a mobile-signup PARENT (synthetic email) is asked for an email', () => {
  // Everything else present, only the synthetic email: the email item is what is
  // missing — the "ask for whichever contact detail is missing" case (§4.1).
  const missing = calculateParentCompletion({
    profile: {
      full_name: 'Aqsa',
      city: 'Islamabad',
      address: 'Somewhere',
      cnic_number: '3520212345671',
      cnic_image_path: 'set',
      phone_verified_at: 'set',
      email: SYNTH,
    },
  }).missing
  assert.deepEqual(missing.map((m) => m.key), ['email'])
})

test("the parent email item's link goes to Settings (not the gap flow)", () => {
  const item = emailItem(calculateParentCompletion({}).items)
  assert.match(checklistHref('parent', item), /\/parent\/dashboard\/settings#email$/)
})
