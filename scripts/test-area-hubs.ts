/**
 * scripts/test-area-hubs.ts — area hubs are built only from curated areas, and
 * internal links never point at a redirect (owner, 13 Oct 2026).
 *
 *   npm run test:areahubs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { areaHubSlug, areaHubsFor, areaStanding, hubSlugRedirect, resolveAreaHub, schoolFromAreaValue } from '../lib/areaHubCore'
import { teamMessagesHref } from '../lib/memberNav'
import { ctaPathFor } from '../lib/ai/platformFacts'
import { countsAsRedirect, internalLinks } from './check-internal-redirects.mjs'

const LAHORE = ['DHA Lahore', 'Bahria Town Lahore', 'Johar Town', 'Wapda Town', 'Model Town', 'Gulberg']
const KARACHI = ['DHA', 'Gulshan-e-Iqbal', 'Gulistan-e-Johar', 'North Nazimabad', 'Nazimabad', 'North Karachi', 'PECHS', 'Federal B Area']

test('"<area>" and "<area> <city>" are one hub, and it keeps the short address', () => {
  assert.equal(areaHubSlug('DHA Lahore', 'Lahore'), 'dha')
  for (const saved of ['DHA', 'dha', 'DHA Lahore', 'DHA, Lahore', ' D.H.A  Lahore ']) {
    const hit = resolveAreaHub('Lahore', saved, LAHORE)
    assert.equal(hit?.area, 'DHA Lahore', saved)
    assert.equal(hit?.how, 'exact', saved)
  }
  // An area whose own name ends with the city keeps its whole name.
  assert.equal(areaHubSlug('North Karachi', 'Karachi'), 'north-karachi')
  assert.equal(resolveAreaHub('Karachi', 'North Karachi', KARACHI)?.area, 'North Karachi')
})

test('spelling variants of one area merge: "gulshan-iqbal" is "Gulshan-e-Iqbal"', () => {
  for (const saved of ['Gulshan Iqbal', 'gulshan-e-iqbal', 'Gulshan e Iqbal', 'GULSHAN-E-IQBAL Karachi']) {
    assert.equal(resolveAreaHub('Karachi', saved, KARACHI)?.area, 'Gulshan-e-Iqbal', saved)
  }
  assert.equal(hubSlugRedirect('Karachi', 'gulshan-iqbal', KARACHI), 'gulshan-e-iqbal')
})

test('a longer value that clearly names one curated area maps to it; an unclear one does not', () => {
  assert.deepEqual(resolveAreaHub('Karachi', 'DHA Phase 5', KARACHI), { area: 'DHA', how: 'contains' })
  assert.equal(resolveAreaHub('Karachi', 'Block 13- A Gulshan-e-Iqbal', KARACHI)?.area, 'Gulshan-e-Iqbal')
  // The longest name wins: "North Nazimabad", never "Nazimabad".
  assert.equal(resolveAreaHub('Karachi', 'Block B North Nazimabad', KARACHI)?.area, 'North Nazimabad')
  // Two different areas, neither opening the value: not a clear match.
  assert.equal(resolveAreaHub('Lahore', 'between Johar Town and Wapda Town', LAHORE), null)
  // The one that opens the value is the area; the other is a landmark.
  assert.equal(resolveAreaHub('Lahore', 'Wapda Town near Johar Town', LAHORE)?.area, 'Wapda Town')
  // No curated area named at all.
  assert.equal(resolveAreaHub('Karachi', 'C9 Ravian Housing Society near johar complex', KARACHI), null)
  // A city with no curated areas never has an area hub.
  assert.equal(resolveAreaHub('Nankana Sahib', 'Model Town', []), null)
})

test('a school or institute name saved as the area is not an area', () => {
  assert.equal(resolveAreaHub('Karachi', 'Al Rafiq Horizon Academy', KARACHI), null)
  assert.equal(schoolFromAreaValue('Al Rafiq Horizon Academy'), 'Al Rafiq Horizon Academy')
  assert.equal(schoolFromAreaValue('Harbanspura'), null)
  assert.deepEqual(areaStanding('Karachi', 'Al Rafiq Horizon Academy', KARACHI), { kind: 'unlisted', looksLikeSchool: true })
  assert.deepEqual(areaStanding('Lahore', 'Harbanspura', LAHORE), { kind: 'unlisted', looksLikeSchool: false })
  assert.deepEqual(areaStanding('Lahore', 'Johar Town', LAHORE), { kind: 'listed', area: 'Johar Town', how: 'exact' })
  assert.deepEqual(areaStanding('Lahore', '  ', LAHORE), { kind: 'empty' })
})

test('hubs: only curated areas, every saved spelling counted in one hub, saved text untouched', () => {
  const saved = ['DHA', 'DHA Lahore', 'DHA Lahore', 'DHA Phase 1', 'Johar Town', 'Harbanspura', 'Harbanspura', 'Harbanspura', 'Manawan Campus', null, '']
  const hubs = areaHubsFor('Lahore', saved, LAHORE)
  assert.deepEqual(hubs.map((h) => [h.slug, h.count]), [['dha', 4], ['johar-town', 1]])
  assert.deepEqual(hubs[0].areas, ['DHA', 'DHA Lahore', 'DHA Phase 1'])
  assert.equal(hubs[0].label, 'DHA')
  // An unlisted area makes no hub however many tuitions carry it.
  assert.ok(!hubs.some((h) => h.slug === 'harbanspura'))
})

test('a merged hub address redirects to the kept one; a kept or unknown one does not', () => {
  assert.equal(hubSlugRedirect('Lahore', 'dha-lahore', LAHORE), 'dha')
  assert.equal(hubSlugRedirect('Lahore', 'bahria-town-lahore', LAHORE), 'bahria-town')
  assert.equal(hubSlugRedirect('Karachi', 'dha-phase-5', KARACHI), 'dha')
  assert.equal(hubSlugRedirect('Lahore', 'dha', LAHORE), null)
  assert.equal(hubSlugRedirect('Lahore', 'female', LAHORE), null)
  assert.equal(hubSlugRedirect('Lahore', 'online', LAHORE), null)
  assert.equal(hubSlugRedirect('Karachi', 'al-rafiq-horizon-academy', KARACHI), null)
})

test('internal links point at the final page: /register and the role inbox, never a redirect', () => {
  assert.equal(ctaPathFor('tutors'), '/register')
  assert.equal(teamMessagesHref('tutor'), '/tutor/dashboard/messages/team')
  assert.equal(teamMessagesHref('parent'), '/parent/dashboard/messages/team')
  assert.equal(teamMessagesHref(null), '/parent/dashboard/messages/team')
})

test('the link checker: internal links only, and a sign-in gate is not a redirecting link', () => {
  const base = 'https://www.tutormint.org'
  const html = `<a class="x" href="/apply">a</a><a href="https://www.tutormint.org/faq#refunds">b</a>
    <a href="https://wa.me/923215872222">c</a><a href="mailto:x@y.z">d</a><a href="#top">e</a><a href="../blog">f</a>`
  assert.deepEqual(internalLinks(html, `${base}/blog/post`, base).sort(), [`${base}/apply`, `${base}/blog`, `${base}/faq`])
  assert.equal(countsAsRedirect(`${base}/apply`, '/register', base), true, '/apply linked from a page of the site is reported')
  assert.equal(countsAsRedirect(`${base}/account/messages`, '/login?next=/account/messages', base), false, 'signed-out gate')
  assert.equal(countsAsRedirect(`${base}/parent/dashboard/post-job`, `${base}/login?next=%2Fparent`, base), false)
  assert.equal(countsAsRedirect(`${base}/api/ads/click/1`, 'https://example.com', base), false)
  assert.equal(countsAsRedirect(`${base}/tuition-jobs/lahore/dha-lahore`, '/tuition-jobs/lahore/dha', base), true)
})
