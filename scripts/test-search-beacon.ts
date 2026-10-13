/**
 * scripts/test-search-beacon.ts — npm run test:searchbeacon
 *
 * Real first-visit searches are counted, and rendering a page never writes
 * (owner, 13 Oct 2026). Pure — no network, no database.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { BEACON_TTL_SECONDS, beaconWorthSending, readBeacon, signBeacon, type BeaconPayload } from '../lib/searchBeaconCore'
import { notCountedReason } from '../lib/searchCountCore'

const SECRET = 'test-secret'
const NOW = Date.parse('2026-10-13T10:00:00Z')
const payload = (over: Partial<BeaconPayload> = {}): BeaconPayload => ({
  s: 'tutors',
  f: { master_id: 12, city: 'Lahore', area: null, mode: null, gender: null },
  x: true,
  r: 7,
  u: null,
  t: Math.floor(NOW / 1000),
  ...over,
})

test('a ticket the server signed reads back; a changed or foreign one does not', () => {
  const token = signBeacon(payload(), SECRET)!
  assert.deepEqual(readBeacon(token, SECRET, NOW), payload())
  // Tampered payload (claiming a search that found nothing).
  const [body, sig] = token.split('.')
  const forged = Buffer.from(JSON.stringify(payload({ u: 'invented search' })), 'utf8').toString('base64url')
  assert.equal(readBeacon(`${forged}.${sig}`, SECRET, NOW), null)
  assert.equal(readBeacon(`${body}.AAAA`, SECRET, NOW), null)
  assert.equal(readBeacon(token, 'another-secret', NOW), null)
  assert.equal(readBeacon('not-a-ticket', SECRET, NOW), null)
  assert.equal(readBeacon(null, SECRET, NOW), null)
})

test('no secret: nothing is signed and nothing is accepted', () => {
  assert.equal(signBeacon(payload(), ''), null)
  assert.equal(readBeacon('a.b', '', NOW), null)
})

test('a ticket expires', () => {
  const token = signBeacon(payload(), SECRET)!
  assert.ok(readBeacon(token, SECRET, NOW + (BEACON_TTL_SECONDS - 5) * 1000))
  assert.equal(readBeacon(token, SECRET, NOW + (BEACON_TTL_SECONDS + 5) * 1000), null)
})

test('a plain Browse visit is not a search; a filter or a miss is', () => {
  assert.equal(beaconWorthSending({ x: false, u: null }), false)
  assert.equal(beaconWorthSending({ x: true, u: null }), true)
  assert.equal(beaconWorthSending({ x: false, u: 'robotics' }), true)
})

test('the rules a beacon search still passes through', () => {
  const browser = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'
  // From the beacon the first-visit stamp is cleared (newVisitor false): a person counts.
  assert.equal(notCountedReason({ userAgent: browser, newVisitor: false }), null)
  // …but a bot, our own crawlers and staff never do.
  assert.equal(notCountedReason({ userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1)', newVisitor: false }), 'bot')
  assert.equal(notCountedReason({ userAgent: 'TutorMint-link-check', newVisitor: false }), 'link_check')
  assert.equal(notCountedReason({ userAgent: 'TutorMint-SEO-audit', newVisitor: false }), 'link_check')
  assert.equal(notCountedReason({ userAgent: browser, staff: true, signedIn: true, newVisitor: false }), 'staff')
})

test('rendering a Browse page never writes a search row; only the beacon route does', () => {
  for (const f of ['app/(site)/browse/tutors/page.tsx', 'app/(site)/browse/tuitions/page.tsx']) {
    const src = readFileSync(f, 'utf8')
    for (const call of ['logSearchPerformed(', 'logAnonSearch(', 'logUnmetSearch(']) {
      assert.ok(!src.includes(call), `${f} must not call ${call}`)
    }
    assert.ok(src.includes('searchBeaconToken(') && src.includes('<SearchBeacon token={beaconToken} />'), f)
  }
  const server = readFileSync('lib/searchBeacon.ts', 'utf8')
  assert.equal((server.match(/fromBeacon: true/g) ?? []).length, 3, 'all three logs are written from the beacon')
  const count = readFileSync('lib/searchCount.ts', 'utf8')
  assert.ok(count.includes('if (input.fromBeacon) newVisitor = false'))
  // Our own crawlers fetch pages and never run their script, so they cannot post.
  for (const f of ['scripts/check-internal-redirects.mjs', 'scripts/audit-seo-live.mjs']) {
    assert.ok(!readFileSync(f, 'utf8').includes('/api/search/log'), f)
  }
})

test('the proxy gives the route the same visitor id it sets on the response', () => {
  const proxy = readFileSync('proxy.ts', 'utf8')
  assert.ok(proxy.includes('headers.set(ANON_ID_HEADER, minted)'))
  assert.ok(proxy.includes('headers.delete(ANON_ID_HEADER)'), 'a client cannot supply its own')
  assert.ok(proxy.includes('response.cookies.set(ANON_COOKIE, minted,'))
})
