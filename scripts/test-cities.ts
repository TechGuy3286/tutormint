import { test } from 'node:test'
import assert from 'node:assert/strict'

import { cityCoord, orderCitiesByDistance } from '../lib/cityDistance'
import { matchVisibilityCities, showsOnlineChipCities } from '../lib/matchChip'
import { feedGenderFilter } from '../lib/jobFeed'
import { whatsappTarget, waMeHref } from '../lib/tutorWhatsapp'

// ---- city distance (PR85 Part B.3) -----------------------------------------

test('cityCoord: known + case-insensitive; unknown → null', () => {
  assert.ok(cityCoord('Lahore'))
  assert.ok(cityCoord('lahore'))
  assert.equal(cityCoord('Atlantis'), null)
  assert.equal(cityCoord(''), null)
})

test('orderCitiesByDistance: nearest first, excludes the from-cities', () => {
  // From Lahore, order Gujranwala (near) vs Karachi (far).
  const ordered = orderCitiesByDistance(['Lahore'], ['Karachi', 'Gujranwala', 'Sialkot'])
  assert.deepEqual(ordered.slice(0, 2), ['Gujranwala', 'Sialkot']) // both nearer than Karachi
  assert.equal(ordered[ordered.length - 1], 'Karachi')
  // The from-city is dropped.
  assert.ok(!orderCitiesByDistance(['Lahore'], ['Lahore', 'Gujranwala']).includes('Lahore'))
})

test('orderCitiesByDistance: unknown-coord cities sort last, not dropped', () => {
  const ordered = orderCitiesByDistance(['Lahore'], ['Atlantis', 'Gujranwala'])
  assert.deepEqual(ordered, ['Gujranwala', 'Atlantis'])
})

test('orderCitiesByDistance: uses the NEAREST of two from-cities', () => {
  // Karachi is far from Lahore but near Hyderabad → with both, Karachi ranks near.
  const ordered = orderCitiesByDistance(['Lahore', 'Hyderabad'], ['Karachi', 'Peshawar'])
  assert.equal(ordered[0], 'Karachi')
})

// ---- multi-city match (PR85 Part A/B) --------------------------------------

test('matchVisibilityCities: same city (either of two) → same_city', () => {
  assert.equal(matchVisibilityCities('Home Tutor', 'Gujranwala', ['Home Tutor'], ['Lahore', 'Gujranwala']), 'same_city')
  assert.equal(matchVisibilityCities('Home Tutor', 'Lahore', ['Home Tutor'], ['Lahore', 'Gujranwala']), 'same_city')
})

test('matchVisibilityCities: cross-city in-person → exclude; online → online', () => {
  assert.equal(matchVisibilityCities('Home Tutor', 'Karachi', ['Home Tutor'], ['Lahore', 'Gujranwala']), 'exclude')
  assert.equal(matchVisibilityCities('Online Tutor', 'Karachi', ['Online Tutor'], ['Lahore']), 'online')
})

test('matchVisibilityCities: no tutor city → online only', () => {
  assert.equal(matchVisibilityCities('Home Tutor', 'Lahore', ['Home Tutor'], []), 'exclude')
  assert.equal(matchVisibilityCities('Online Tutor', 'Lahore', ['Online Tutor'], []), 'online')
})

test('showsOnlineChipCities: only for a cross-city online match', () => {
  assert.equal(showsOnlineChipCities('Online Tutor', 'Karachi', ['Online Tutor'], ['Lahore']), true)
  assert.equal(showsOnlineChipCities('Online Tutor', 'Lahore', ['Online Tutor'], ['Lahore']), false) // same city, no chip
  assert.equal(showsOnlineChipCities('Home Tutor', 'Karachi', ['Home Tutor'], ['Lahore']), false) // excluded, not online
})

// ---- gender feed filter (PR85 Part C) --------------------------------------

test('feedGenderFilter: male/female filter; other/null/empty do not', () => {
  assert.equal(feedGenderFilter('male'), 'male')
  assert.equal(feedGenderFilter('Female'), 'female')
  assert.equal(feedGenderFilter('other'), null)
  assert.equal(feedGenderFilter(null), null)
  assert.equal(feedGenderFilter(''), null)
})

// ---- WhatsApp target (PR86) ------------------------------------------------

test('whatsappTarget: prefers WhatsApp, falls back to legacy col then mobile', () => {
  // A real WhatsApp number (any input shape → normalised MSISDN).
  assert.deepEqual(whatsappTarget({ whatsapp: '0300 1234567', phone: '923009999999' }), { msisdn: '923001234567', isWhatsapp: true })
  // Legacy tutor_profiles.whatsapp_number when profiles.whatsapp is empty.
  assert.deepEqual(whatsappTarget({ whatsapp: null, whatsappNumber: '03011234567', phone: '923009999999' }), { msisdn: '923011234567', isWhatsapp: true })
  // No WhatsApp → the verified mobile, flagged as not-WhatsApp.
  assert.deepEqual(whatsappTarget({ whatsapp: '', phone: '0321 5872222' }), { msisdn: '923215872222', isWhatsapp: false })
  // Nothing usable → null.
  assert.deepEqual(whatsappTarget({}), { msisdn: null, isWhatsapp: false })
  // An invalid WhatsApp value is ignored, falling through to the mobile.
  assert.equal(whatsappTarget({ whatsapp: 'not-a-number', phone: '923001234567' }).isWhatsapp, false)
})

test('waMeHref builds the wa.me link or null', () => {
  assert.equal(waMeHref({ msisdn: '923001234567', isWhatsapp: true }), 'https://wa.me/923001234567')
  assert.equal(waMeHref({ msisdn: null, isWhatsapp: false }), null)
})
