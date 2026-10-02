/**
 * scripts/test-degrees.ts  —  npm run test:degrees
 *
 * Pure tests for PR106-A: the multiple-degrees model (lib/degrees) and the CNIC
 * step-view decision (lib/cnicStep). Nothing here touches the database.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseCredential,
  degreeLabels,
  activeCredentials,
  serializeCredential,
} from '../lib/degrees'
import { cnicStepView } from '../lib/cnicStep'

// --------------------------------------------------- multiple degrees ------

test('multiple degrees: save then load round-trips every entry, in order', () => {
  const stored = [
    serializeCredential({ title: 'BSc Physics — Punjab University' }),
    serializeCredential({ title: 'MSc Mathematics', docId: 'doc-123' }),
  ]
  const loaded = activeCredentials(stored)
  assert.equal(loaded.length, 2)
  assert.equal(loaded[0].title, 'BSc Physics — Punjab University')
  assert.equal(loaded[0].docId, '')
  assert.equal(loaded[1].title, 'MSc Mathematics')
  assert.equal(loaded[1].docId, 'doc-123')
  assert.deepEqual(degreeLabels(stored), ['BSc Physics — Punjab University', 'MSc Mathematics'])
})

test('certificate optional: a degree with no docId is a plain string, loads fine, shows no certificate', () => {
  const s = serializeCredential({ title: 'BA English' })
  assert.equal(s, 'BA English', 'a simple degree stays a plain string, never re-wrapped')
  const c = parseCredential(s)
  assert.equal(c.title, 'BA English')
  assert.equal(c.docId, '')
  assert.equal(c.paused, false)
})

test('a degree WITH a certificate serialises to JSON carrying its docId', () => {
  const s = serializeCredential({ title: 'BE Civil', docId: 'abc' })
  assert.ok(s.startsWith('{'), 'carries structure when it has a certificate')
  const c = parseCredential(s)
  assert.equal(c.title, 'BE Civil')
  assert.equal(c.docId, 'abc')
})

test('removing a degree pauses it: paused entries are kept in storage but hidden from every reader', () => {
  const stored = [
    serializeCredential({ title: 'Active degree' }),
    serializeCredential({ title: 'Removed degree', docId: 'd9', paused: true }),
  ]
  // Readers (public profile / CV / admin all use degreeLabels) show only active.
  assert.deepEqual(degreeLabels(stored), ['Active degree'])
  // activeCredentials also drops paused.
  assert.deepEqual(activeCredentials(stored).map((c) => c.title), ['Active degree'])
  // But the paused entry is still physically in the array (nothing deleted).
  assert.equal(stored.length, 2)
  assert.equal(parseCredential(stored[1]).paused, true)
})

test('legacy shapes still read: plain strings and JSON objects both decode', () => {
  assert.deepEqual(degreeLabels(['BS Physics — Punjab University (2019)']), ['BS Physics — Punjab University (2019)'])
  assert.deepEqual(
    degreeLabels(['{"title":"BS COMPUTER SCIENCE","year":"2024","institute":"PU"}']),
    ['BS COMPUTER SCIENCE, PU (2024)'],
  )
})

// ------------------------------------------------------- CNIC step view ----

test('CNIC prefill: a half-entered card returns to the capture view (so the saved parts show)', () => {
  assert.equal(cnicStepView({ state: 'none', hasNumber: true, hasFront: true, hasBack: false }), 'capture')
  assert.equal(cnicStepView({ state: 'none', hasNumber: false, hasFront: false, hasBack: false }), 'capture')
})

test('CNIC locked after approval ONLY when number + both photos are on file', () => {
  assert.equal(cnicStepView({ state: 'approved', hasNumber: true, hasFront: true, hasBack: true }), 'approved')
  // Approved marker but a document missing → still "being checked", never locked.
  assert.equal(cnicStepView({ state: 'approved', hasNumber: true, hasFront: true, hasBack: false }), 'submitted')
})

test('CNIC submitted shows the being-checked view', () => {
  assert.equal(cnicStepView({ state: 'submitted', hasNumber: true, hasFront: true, hasBack: true }), 'submitted')
})
