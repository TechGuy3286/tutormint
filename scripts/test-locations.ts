/**
 * scripts/test-locations.ts
 *
 *   npm run test:locations
 *
 * The pure core of the city/area lists (lib/cityAreasCore.ts) — the ordering,
 * the area-dependent-on-city rule, and the curated/free-text distinction that
 * the whole migration turns on. No database: the map is built from rows exactly
 * as the client fetch and the admin review build it.
 *
 * Covers the owner's tests: every supplied city resolves to its OWN areas; a
 * city with no match returns an EMPTY list (never another city's areas);
 * free text is recognised as not-curated (so it is preserved and reviewable);
 * and an existing value that IS curated still resolves after the migration.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildCityAreaMap,
  areasForCity,
  isCuratedCity,
  isCuratedArea,
  type CityAreaMap,
} from '../lib/cityAreasCore'

// A small slice of the real dataset (migration 73), in scrambled input order so
// the sort is genuinely exercised.
const map: CityAreaMap = buildCityAreaMap({
  cities: [
    { name: 'Faisalabad', sort_order: 100 },
    { name: 'Islamabad', sort_order: 3 },
    { name: 'Karachi', sort_order: 2 },
    { name: 'Abbottabad', sort_order: 100 },
    { name: 'Lahore', sort_order: 1 },
    { name: 'Rawalpindi', sort_order: 4 },
  ],
  areas: [
    { city: 'Karachi', name: 'PECHS' },
    { city: 'Karachi', name: 'Clifton' },
    { city: 'Karachi', name: 'DHA Karachi' },
    { city: 'Lahore', name: 'Gulberg' },
    { city: 'Lahore', name: 'DHA Lahore' },
    { city: 'Islamabad', name: 'F-6' },
  ],
})

test('cities sort: Lahore, Karachi, Islamabad, Rawalpindi first, then alphabetical', () => {
  assert.deepEqual(map.cities, [
    'Lahore',
    'Karachi',
    'Islamabad',
    'Rawalpindi',
    'Abbottabad',
    'Faisalabad',
  ])
})

test('every city resolves to its OWN areas, sorted alphabetically', () => {
  assert.deepEqual(areasForCity(map, 'Karachi'), ['Clifton', 'DHA Karachi', 'PECHS'])
  assert.deepEqual(areasForCity(map, 'Lahore'), ['DHA Lahore', 'Gulberg'])
  assert.deepEqual(areasForCity(map, 'Islamabad'), ['F-6'])
  // Verbatim spelling is preserved — never "corrected".
  assert.ok(areasForCity(map, 'Karachi').includes('PECHS'))
})

test('a city with no areas returns EMPTY, never another city’s areas', () => {
  // A curated city with no seeded areas here.
  assert.deepEqual(areasForCity(map, 'Rawalpindi'), [])
  // An unknown/free-text city.
  assert.deepEqual(areasForCity(map, 'Nankana Sahib'), [])
  assert.deepEqual(areasForCity(map, ''), [])
  assert.deepEqual(areasForCity(map, null), [])
})

test('city lookup is case-insensitive (existing rows like "LAHORE" still resolve)', () => {
  assert.deepEqual(areasForCity(map, 'lahore'), ['DHA Lahore', 'Gulberg'])
  assert.equal(isCuratedCity(map, 'LAHORE'), true)
})

test('curated vs free-text: the distinction that drives review + preservation', () => {
  // Curated → resolves, not flagged as free text.
  assert.equal(isCuratedCity(map, 'Karachi'), true)
  assert.equal(isCuratedArea(map, 'Karachi', 'Clifton'), true)
  assert.equal(isCuratedArea(map, 'Karachi', 'clifton'), true)

  // Free text → not curated, so it is preserved and surfaces for review. These
  // are the exact unmapped values the migration reported.
  assert.equal(isCuratedCity(map, 'Nankana Sahib'), false)
  assert.equal(isCuratedArea(map, 'Lahore', 'DHA'), false) // curated has "DHA Lahore"
  assert.equal(isCuratedArea(map, 'Lahore', 'DHA Phase 5'), false) // omitted from the dataset
  assert.equal(isCuratedArea(map, 'Karachi', 'DHA'), false) // curated has "DHA Karachi"

  // An area under an unknown city is not curated either.
  assert.equal(isCuratedArea(map, 'Nankana Sahib', 'Model Town'), false)
})

test('free-text round trip: a typed value is neither corrected nor lost', () => {
  // The store is the plain string column; the "distinct" store is that it is not
  // in the curated map. buildCityAreaMap does not add it, and isCurated* report
  // it as free text — so it survives verbatim and is reviewable.
  const typed = 'Nankana Sahib'
  assert.equal(map.cities.includes(typed), false)
  assert.equal(isCuratedCity(map, typed), false)
  // The value itself is untouched by any of the helpers.
  assert.equal(areasForCity(map, typed).length, 0)
})
