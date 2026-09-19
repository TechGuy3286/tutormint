/**
 * scripts/test-labels.ts — npm run test:labels
 *
 * The plain-words helpers (PR31 §5/§6): proper-case names, humanized keys, and
 * admin-action labels. Pure — no DB.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { properName, humanizeKey, adminActionLabel } from '../lib/display'

test('properName fixes shouty and lower input, keeps deliberate caps', () => {
  assert.equal(properName('ALEE SABEER'), 'Alee Sabeer')
  assert.equal(properName('alee sabeer'), 'Alee Sabeer')
  assert.equal(properName('Alee Sabeer'), 'Alee Sabeer')
  // A word with deliberate internal caps is left alone.
  assert.equal(properName('McAli al-Rashid'), 'McAli al-Rashid')
  assert.equal(properName('  hina   aslam '), 'Hina Aslam')
  assert.equal(properName(''), '')
  assert.equal(properName(null), '')
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
