import assert from 'node:assert/strict'
import { test } from 'node:test'

import { areaWithoutCity, dedupeCityInText, placeLabel } from '../lib/place'
import { applyBlockFor } from '../lib/applyBlock'

// owner, 5 Oct 2026 — "never repeat the city" and "why Apply is inactive".

test('placeLabel never repeats the city', () => {
  assert.equal(placeLabel('Bahria Town Lahore', 'Lahore'), 'Bahria Town, Lahore')
  assert.equal(placeLabel('DHA Karachi', 'Karachi'), 'DHA, Karachi')
  assert.equal(placeLabel('Gulberg, Lahore', 'Lahore'), 'Gulberg, Lahore')
  assert.equal(placeLabel('Bahria Town lahore', 'Lahore'), 'Bahria Town, Lahore')
  assert.equal(placeLabel('DHA', 'Lahore'), 'DHA, Lahore')
  assert.equal(placeLabel('Lahore', 'Lahore'), 'Lahore')
  assert.equal(placeLabel(null, 'Lahore'), 'Lahore')
  assert.equal(placeLabel('DHA', null), 'DHA')
  assert.equal(placeLabel('', ''), '')
  // A city name INSIDE the area (not a suffix) is left alone.
  assert.equal(placeLabel('Lahore Cantt', 'Lahore'), 'Lahore Cantt, Lahore')
  // The city is part of the area's own name — never "North, Karachi" and never
  // "North Karachi, Karachi": the area stands alone.
  assert.equal(placeLabel('North Karachi', 'Karachi'), 'North Karachi')
  assert.equal(placeLabel('New Karachi', 'Karachi'), 'New Karachi')
  assert.equal(areaWithoutCity('Bahria Town Lahore', 'Lahore'), 'Bahria Town')
})

test('dedupeCityInText fixes the exact doubled form only', () => {
  assert.equal(dedupeCityInText('Home Tutor in Bahria Town Lahore, Lahore', 'Lahore'), 'Home Tutor in Bahria Town Lahore')
  assert.equal(dedupeCityInText('Tutor in DHA, Lahore', 'Lahore'), 'Tutor in DHA, Lahore')
  assert.equal(dedupeCityInText('X Karachi, karachi and more', 'Karachi'), 'X Karachi and more')
})

test('applyBlockFor: first reason wins, in the fixed order', () => {
  const base = { hasPlan: true, quotaLeft: 3, quota: 10, unlimitedDisplay: false, docRejected: false, jobStatus: 'open' as string | null }
  assert.equal(applyBlockFor(base), null)
  assert.deepEqual(applyBlockFor({ ...base, appliedAt: '2026-10-01T00:00:00Z' }), { kind: 'applied', appliedAt: '2026-10-01T00:00:00Z' })
  assert.deepEqual(applyBlockFor({ ...base, quotaLeft: 0 }), { kind: 'quota', quota: 10, unlimited: false })
  assert.deepEqual(applyBlockFor({ ...base, docRejected: true, reuploadHref: '/x' }), { kind: 'doc', href: '/x' })
  assert.deepEqual(applyBlockFor({ ...base, jobStatus: 'paused' }), { kind: 'closed' })
  assert.deepEqual(applyBlockFor({ ...base, jobStatus: 'closed' }), { kind: 'closed' })
  // Several at once → applied beats quota beats doc beats closed.
  assert.equal(applyBlockFor({ ...base, appliedAt: '2026-10-01T00:00:00Z', quotaLeft: 0, docRejected: true, jobStatus: 'closed' })?.kind, 'applied')
  assert.equal(applyBlockFor({ ...base, quotaLeft: 0, docRejected: true, jobStatus: 'closed' })?.kind, 'quota')
  assert.equal(applyBlockFor({ ...base, docRejected: true, jobStatus: 'closed' })?.kind, 'doc')
  // No plan (unverified) → quota never blocks; the verify gate handles that path.
  assert.equal(applyBlockFor({ ...base, hasPlan: false, quotaLeft: 0 }), null)
  // "Unlimited" plans never surface the real cap.
  assert.deepEqual(applyBlockFor({ ...base, quotaLeft: 0, quota: 100, unlimitedDisplay: true }), { kind: 'quota', quota: 100, unlimited: true })
})
