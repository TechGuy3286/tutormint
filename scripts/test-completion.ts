/**
 * scripts/test-completion.ts — npm run test:completion
 *
 * The PR29 §4 contact-email completion item: a real (non-synthetic) email
 * counts, a synthetic <msisdn>@users.tutormint.org does not, and the item's
 * link goes to Settings for both roles.
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

test('tutor: email item done with a real email, not with a synthetic one', () => {
  assert.equal(emailItem(calculateTutorCompletion({ profile: { email: REAL } }).items).done, true)
  assert.equal(emailItem(calculateTutorCompletion({ profile: { email: SYNTH } }).items).done, false)
  assert.equal(emailItem(calculateTutorCompletion({ profile: {} }).items).done, false)
})

test('parent: email item done with a real email, not with a synthetic one', () => {
  assert.equal(emailItem(calculateParentCompletion({ profile: { email: REAL } }).items).done, true)
  assert.equal(emailItem(calculateParentCompletion({ profile: { email: SYNTH } }).items).done, false)
})

test('a mobile-signup account (synthetic email) is asked for an email', () => {
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

test("the email item's link goes to Settings for both roles (not the gap flow)", () => {
  const item = emailItem(calculateTutorCompletion({}).items)
  assert.match(checklistHref('tutor', item), /\/tutor\/dashboard\/settings#email$/)
  assert.match(checklistHref('parent', item), /\/parent\/dashboard\/settings#email$/)
})

test('an email-signup account (real email) has the email item done and is not asked', () => {
  const c = calculateTutorCompletion({ profile: { email: REAL } })
  assert.equal(c.missing.some((m) => m.key === 'email'), false)
})
