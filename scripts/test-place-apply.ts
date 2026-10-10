import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readFileSync } from 'node:fs'

import { areaWithoutCity, dedupeCityInText, distinctAreaLabels, placeLabel } from '../lib/place'
import { repeatsAreaName } from '../lib/tutorAreaCities'
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

// owner, 10 Oct 2026 — "Area: DHA, DHA +1 more" on a tutor card.
test('tutor area labels are distinct, and "+N more" counts distinct areas', () => {
  const labels = (...a: Parameters<typeof distinctAreaLabels>) => distinctAreaLabels(...a).map((x) => x.label)
  // The live case: "DHA" and the curated "DHA Lahore" under Lahore are one area.
  const zuha = distinctAreaLabels(['DHA', 'DHA Lahore', 'Cantt'], 'Lahore')
  assert.deepEqual(zuha.map((x) => x.label), ['DHA', 'Cantt'])
  assert.equal(zuha.length - zuha.slice(0, 2).length, 0, 'no "+1 more" for a repeat')
  assert.equal(zuha[0].area, 'DHA', 'the link keeps the first saved value')
  assert.equal(zuha[0].city, 'Lahore')
  // An exact repeat, in any case or spacing, is shown once.
  assert.deepEqual(labels(['Gulberg', 'gulberg ', 'GULBERG', 'Johar Town', 'Model Town'], 'Lahore'), ['Gulberg', 'Johar Town', 'Model Town'])
  const four = distinctAreaLabels(['Gulberg', 'Gulberg', 'Johar Town', 'Model Town'], 'Lahore')
  assert.equal(four.length - 2, 1, '"+1 more": Model Town only')
  // Same name in two cities, city known per area.
  assert.deepEqual(
    labels(['DHA', 'DHA', 'Clifton'], 'Lahore', { cities: ['Lahore', 'Karachi'], areaCities: ['Lahore', 'Karachi', 'Karachi'] }),
    ['DHA (Lahore)', 'DHA (Karachi)', 'Clifton'],
  )
  // Same name in two cities, read off the curated names.
  const two = distinctAreaLabels(['DHA Lahore', 'DHA Karachi'], 'Lahore', { cities: ['Lahore', 'Karachi'] })
  assert.deepEqual(two.map((x) => x.label), ['DHA (Lahore)', 'DHA (Karachi)'])
  assert.deepEqual(two.map((x) => x.city), ['Lahore', 'Karachi'])
  assert.deepEqual(two.map((x) => x.area), ['DHA Lahore', 'DHA Karachi'])
  // Different areas are untouched; an area that carries the city stays whole.
  assert.deepEqual(labels(['DHA', 'Bahria Town Lahore', 'Cantt'], 'Lahore'), ['DHA', 'Bahria Town', 'Cantt'])
  assert.deepEqual(labels(['North Karachi', 'Clifton'], 'Karachi'), ['North Karachi', 'Clifton'])
  // Blanks and empties.
  assert.deepEqual(labels([null, '', '  '], 'Lahore'), [])
  assert.deepEqual(labels(null, 'Lahore'), [])
  assert.deepEqual(labels(['DHA', 'DHA'], null), ['DHA'])
  // No label is ever shown twice.
  for (const list of [zuha, four, two]) assert.equal(new Set(list.map((x) => x.label)).size, list.length)
})

test('the city lookup runs only for a list that repeats a name; the card and profile use the one rule', () => {
  assert.equal(repeatsAreaName(['DHA', 'dha ']), true)
  assert.equal(repeatsAreaName(['DHA', 'DHA Lahore', 'Cantt']), false)
  assert.equal(repeatsAreaName(null), false)
  for (const p of ['components/TutorCard.tsx', 'app/(site)/tutor/[slug]/page.tsx']) {
    const src = readFileSync(p, 'utf8')
    assert.match(src, /distinctAreaLabels\(/, p + ' uses distinctAreaLabels')
    assert.doesNotMatch(src, /areaWithoutCity/, p + ' builds no area label of its own')
  }
  assert.match(readFileSync('components/TutorCard.tsx', 'utf8'), /const extra = list\.length - shown\.length/)
})
