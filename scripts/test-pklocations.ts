/**
 * scripts/test-pklocations.ts
 *
 *   npm run test:pklocations
 *
 * The city → province and city/area → postcode lookup (lib/pkLocations.ts) that
 * fills addressRegion and postalCode in the JobPosting structured data (PR51).
 * Pure, no database. Confirms every supported city maps to a province, the
 * confident postcodes resolve, an area with no code falls back to its city's
 * code, matching is case-insensitive, and an unknown city yields null (so the
 * caller omits the field rather than emitting a guess).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { provinceForCity, postcodeFor } from '../lib/pkLocations'

const ALL_CITIES = [
  'Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Abbottabad', 'Bahawalpur',
  'Dera Ghazi Khan', 'Faisalabad', 'Gujranwala', 'Gujrat', 'Hyderabad', 'Jhelum',
  'Larkana', 'Mardan', 'Mingora', 'Multan', 'Peshawar', 'Quetta', 'Sahiwal',
  'Sargodha', 'Sialkot', 'Sukkur', 'Wah Cantt',
]

test('every supported city maps to a province', () => {
  for (const c of ALL_CITIES) {
    assert.ok(provinceForCity(c), `no province for ${c}`)
  }
})

test('provinces are correct for the sample the JSON-LD will emit', () => {
  assert.equal(provinceForCity('Lahore'), 'Punjab')
  assert.equal(provinceForCity('Karachi'), 'Sindh')
  assert.equal(provinceForCity('Islamabad'), 'Islamabad Capital Territory')
  assert.equal(provinceForCity('Peshawar'), 'Khyber Pakhtunkhwa')
  assert.equal(provinceForCity('Quetta'), 'Balochistan')
})

test('matching is case-insensitive and trimmed (jobs store "lahore")', () => {
  assert.equal(provinceForCity('lahore'), 'Punjab')
  assert.equal(provinceForCity('  Lahore  '), 'Punjab')
  assert.equal(postcodeFor('lahore', null), '54000')
})

test('confident city postcodes resolve', () => {
  assert.equal(postcodeFor('Lahore', null), '54000')
  assert.equal(postcodeFor('Karachi', null), '74000')
  assert.equal(postcodeFor('Islamabad', null), '44000')
  assert.equal(postcodeFor('Rawalpindi', null), '46000')
  assert.equal(postcodeFor('Faisalabad', null), '38000')
})

test('an area with no confident code falls back to the city code', () => {
  assert.equal(postcodeFor('Lahore', 'Model Town'), '54000')
  assert.equal(postcodeFor('Karachi', 'Clifton'), '74000')
})

test('a city we cannot map yields null (caller omits the field)', () => {
  assert.equal(provinceForCity('Nowhere'), null)
  assert.equal(postcodeFor('Sahiwal', null), null) // supported city, code not yet confident
  assert.equal(postcodeFor(null, null), null)
})
