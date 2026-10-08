/**
 * scripts/test-completion.ts — npm run test:completion
 *
 * Email never counts toward completion for EITHER role (owner, 5 Oct 2026): a
 * tutor (15 items) and a parent (6 items) with only a verified mobile reach
 * 100%. hasRealEmail stays the one predicate for "a real, sendable address".
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { calculateTutorCompletion, calculateParentCompletion, hasRealEmail } from '../lib/profileChecklist'

const REAL = 'aqsa@example.com'
const SYNTH = '923001234567@users.tutormint.org'

test('hasRealEmail: real yes, synthetic no, empty no', () => {
  assert.equal(hasRealEmail(REAL), true)
  assert.equal(hasRealEmail(SYNTH), false)
  assert.equal(hasRealEmail(''), false)
  assert.equal(hasRealEmail(null), false)
  assert.equal(hasRealEmail(undefined), false)
})

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
  const noBio = calculateTutorCompletion({ ...FULL_TUTOR, tutorProfile: { ...FULL_TUTOR.tutorProfile, bio: '' } })
  const noBioEmail = calculateTutorCompletion({ ...FULL_TUTOR, profile: { ...FULL_TUTOR.profile, email: REAL }, tutorProfile: { ...FULL_TUTOR.tutorProfile, bio: '' } })
  assert.equal(noBio.percent, noBioEmail.percent)
  assert.equal(noBio.percent, 93)
})

// A parent with ONLY a verified mobile — the synthetic login address, no inbox.
const MOBILE_ONLY_PARENT = {
  profile: {
    full_name: 'Aqsa',
    city: 'Islamabad',
    address: 'Somewhere',
    cnic_number: '3520212345671',
    cnic_image_path: 'set',
    phone_verified_at: 'set',
    email: SYNTH,
  },
}

test('parent: a mobile-only complete parent is 100% — email is not an item (item 7)', () => {
  const c = calculateParentCompletion(MOBILE_ONLY_PARENT)
  assert.equal(c.items.length, 6)
  assert.equal(c.items.some((i) => i.key === 'email'), false)
  assert.equal(c.percent, 100)
  assert.deepEqual(c.missing, [])
  // A real email changes nothing either way.
  const withEmail = calculateParentCompletion({ profile: { ...MOBILE_ONLY_PARENT.profile, email: REAL } })
  assert.equal(withEmail.percent, 100)
  // One missing item is the same % with or without an email.
  const noAddress = calculateParentCompletion({ profile: { ...MOBILE_ONLY_PARENT.profile, address: '' } })
  const noAddressEmail = calculateParentCompletion({ profile: { ...MOBILE_ONLY_PARENT.profile, address: '', email: REAL } })
  assert.equal(noAddress.percent, noAddressEmail.percent)
  // Address and CNIC are OPTIONAL now (owner, 8 Oct 2026): a suggestion, never missing.
  assert.equal(noAddress.percent, 100)
  assert.deepEqual(noAddress.missing.map((m) => m.key), [])
  assert.deepEqual(noAddress.suggestions.map((m) => m.key), ['address'])
  // Without a verified mobile the parent is NOT complete.
  const noMobile = calculateParentCompletion({ profile: { ...MOBILE_ONLY_PARENT.profile, phone_verified_at: null } })
  assert.deepEqual(noMobile.missing.map((m) => m.key), ['phone'])
})
