/**
 * scripts/test-labels.ts — npm run test:labels
 *
 * The plain-words helpers (PR31 §5/§6): proper-case names, humanized keys, and
 * admin-action labels. Pure — no DB.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { properName, humanizeKey, adminActionLabel } from '../lib/display'
import { formatName } from '../lib/formatName'

test('properName = the one name rule (#46): every word capitalised, rest lower case', () => {
  assert.equal(properName('ALEE SABEER'), 'Alee Sabeer')
  assert.equal(properName('alee sabeer'), 'Alee Sabeer')
  assert.equal(properName('Alee Sabeer'), 'Alee Sabeer')
  // #46 (owner, 5 Oct 2026): the rule is strict — "ali RAZA" → "Ali Raza" — so
  // internal caps are NOT preserved any more; hyphen parts are each capitalised.
  assert.equal(properName('ali RAZA'), 'Ali Raza')
  assert.equal(properName('McAli al-Rashid'), 'Mcali Al-Rashid')
  assert.equal(properName('  hina   aslam '), 'Hina Aslam')
  assert.equal(properName(''), '')
  assert.equal(properName(null), '')
})

test('formatName is the shared formatter properName delegates to', () => {
  assert.equal(formatName('ali RAZA'), 'Ali Raza')
  assert.equal(formatName("d'souza  KHAN"), "D'Souza Khan")
  // The brand name on the team account keeps its own casing.
  assert.equal(formatName('tutormint'), 'TutorMint')
  // Urdu has no case and passes through untouched.
  assert.equal(formatName('علی رضا'), 'علی رضا')
  assert.equal(formatName(undefined), '')
})

test('humanizeKey turns a key into readable words, never raw', () => {
  assert.equal(humanizeKey('email_confirmed'), 'Email confirmed')
  assert.equal(humanizeKey('staff.remove'), 'Staff remove')
  assert.equal(humanizeKey('some_new_event'), 'Some new event')
  assert.equal(humanizeKey(''), '')
})

test('adminActionLabel maps known actions, humanizes the rest', () => {
  assert.equal(adminActionLabel('staff.remove'), 'Removed from staff')
  assert.equal(adminActionLabel('staff.create'), 'Added to staff')
  assert.equal(adminActionLabel('plan.grant'), 'Plan granted')
  assert.equal(adminActionLabel('payment.approve'), 'Payment approved')
  assert.equal(adminActionLabel('parent.verify.approve'), 'Approved parent verification')
  // An unmapped action never comes back as the raw key.
  const unknown = adminActionLabel('some.future_action')
  assert.equal(unknown, 'Some future action')
  assert.ok(!unknown.includes('.'))
})
