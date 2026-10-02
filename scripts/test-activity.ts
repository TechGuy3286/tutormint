import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  maskSearchTerm,
  isBotUserAgent,
  cleanEvents,
  clampActiveDelta,
  pageLabel,
  describeActivityEvent,
} from '../lib/activityTrack'

// PR99 §2 — the pure activity-telemetry rules. The ingest route, the client and
// these tests share them, so "no phone/email/password/etc stored" and the plain
// wording are checked here rather than only asserted in prose.

test('maskSearchTerm masks phone numbers and emails, keeps real terms', () => {
  assert.equal(maskSearchTerm('physics lahore'), 'physics lahore')
  assert.equal(maskSearchTerm('TM-1450'), 'TM-1450') // 4 digits — a reference, kept
  assert.equal(maskSearchTerm('call me 03001234567'), 'call me [number]')
  assert.equal(maskSearchTerm('+92 300 1234567'), '[number]')
  assert.equal(maskSearchTerm('ali@example.com please'), '[email] please')
  assert.ok(!/03001234567/.test(maskSearchTerm('03001234567')))
})

test('isBotUserAgent flags bots and a missing UA, allows a real browser', () => {
  assert.equal(isBotUserAgent('Mozilla/5.0 (iPhone) AppleWebKit Safari'), false)
  assert.equal(isBotUserAgent('Googlebot/2.1'), true)
  assert.equal(isBotUserAgent('python-requests/2.31'), true)
  assert.equal(isBotUserAgent(''), true)
  assert.equal(isBotUserAgent(null), true)
})

test('cleanEvents drops unknown kinds, masks a search label, whitelists actions', () => {
  const out = cleanEvents([
    { kind: 'page_view', path: '/browse/tutors', label: 'Browsed tutors' },
    { kind: 'search', label: 'physics 03001234567', resultCount: 12 },
    { kind: 'action', label: 'applied' },
    { kind: 'action', label: 'stealpassword' }, // not whitelisted → dropped
    { kind: 'evil', label: 'x' }, // unknown kind → dropped
  ])
  assert.equal(out.length, 3)
  assert.equal(out[0].kind, 'page_view')
  assert.equal(out[1].label, 'physics [number]') // masked
  assert.equal(out[1].resultCount, 12)
  assert.equal(out[2].label, 'applied')
})

test('cleanEvents strips non-whitelisted meta keys and non-scalars', () => {
  const [e] = cleanEvents([{ kind: 'search', label: 'maths', meta: { where: 'browse', BAD: 'x', nested: { a: 1 }, n: 5 } }])
  assert.deepEqual(Object.keys(e.meta).sort(), ['n', 'where'])
})

test('clampActiveDelta bounds a tampered time to <= 2 min and rejects junk', () => {
  assert.equal(clampActiveDelta(30000), 30000)
  assert.equal(clampActiveDelta(999999999), 120000)
  assert.equal(clampActiveDelta(-5), 0)
  assert.equal(clampActiveDelta('nope'), 0)
})

test('pageLabel gives plain English per path', () => {
  assert.equal(pageLabel('/browse/tutors'), 'Browsed tutors')
  assert.equal(pageLabel('/membership-plans'), 'Viewed Membership Plans')
  assert.equal(pageLabel('/tutor/some-slug'), 'Viewed a tutor profile')
  assert.equal(pageLabel('/tutor/dashboard/messages'), 'Tutor dashboard — messages')
  assert.match(pageLabel('/tutors/lahore/o-levels-physics'), /tutors in lahore/i)
})

test('describeActivityEvent reads in plain English', () => {
  assert.equal(describeActivityEvent({ kind: 'search', label: 'physics lahore', resultCount: 12 }), 'Searched “physics lahore” — 12 results')
  assert.equal(describeActivityEvent({ kind: 'search', label: 'x', resultCount: 1 }), 'Searched “x” — 1 result')
  assert.equal(describeActivityEvent({ kind: 'action', label: 'viewed_contact' }), 'Viewed a contact number')
  assert.equal(describeActivityEvent({ kind: 'page_view', label: 'Viewed tuition TM-1450' }), 'Viewed tuition TM-1450')
})
