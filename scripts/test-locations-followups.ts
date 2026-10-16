// scripts/test-locations-followups.ts — Locations follow-ups (owner, 16 Oct 2026).
//   npm run test:locationsfollowups
// A hub counts tuitions from areas merged into it; a retired area's hub moves
// on permanently and is never a hub (so never in the sitemap); "Keep as its own
// area" is the Owner's only; bulk buttons are disabled at 0; suggestions never
// cut a multi-word place name in half; My sign-ups "This month" matches Team
// activity; the short-name report.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { areaHubSlug, areaHubsFor, hubSlugRedirect, resolveAreaHub, type CityAliases } from '../lib/areaHubCore'
import { canApprove } from '../lib/adminAccessCore'
import { reviewCountsView } from '../lib/locationCountsCore'
import { keepAreaProblem, splitAreaLandmark } from '../lib/staffAreaCore'
import { shortNameCandidates } from '../lib/areaMergeCore'
import { EMPTY_FILTERS, filterRows, myMonthView, type MySignupRow } from '../lib/mySignupsCore'
import type { CreditedAccount } from '../lib/staffSignupsCore'

// Karachi after the Owner's merges: Johar and Gulshan are retired; their names
// are approved spellings of the areas they joined.
const CURATED = ['Gulistan-e-Johar', 'Gulshan-e-Iqbal', 'Gulshan-e-Roomi', 'Malir', 'Askari-2', 'Johar Mor']
const ALIASES: CityAliases = { johar: 'Gulistan-e-Johar', gulshan: 'Gulshan-e-Iqbal', 'gulshan block': 'Gulshan-e-Iqbal' }

test('a hub counts tuitions from the areas merged into it', () => {
  const saved = [
    'Gulistan-e-Johar',
    'Block 14 Gulistan-e-Johar',
    'Johar block 12',
    'C9 Ravian Housing Society near johar complex',
    'Johar campus 2 block 16',
    'Gulshan ( Near Muskan chowrangi)',
    'Gulshan',
    'Gulshan-e-Iqbal',
  ]
  const hubs = areaHubsFor('Karachi', saved, CURATED, ALIASES)
  const by = Object.fromEntries(hubs.map((h) => [h.slug, h.count]))
  assert.equal(by['gulistan-e-johar'], 5, 'Johar values count on Gulistan-e-Johar')
  assert.equal(by['gulshan-e-iqbal'], 3, 'Gulshan values count on Gulshan-e-Iqbal')
  assert.equal(by['gulshan'], undefined, 'the retired area has no hub of its own')
  assert.equal(by['johar'], undefined)
  // TM-1214's own area link goes to the main area.
  assert.equal(resolveAreaHub('Karachi', 'Gulshan ( Near Muskan chowrangi)', CURATED, ALIASES)?.area, 'Gulshan-e-Iqbal')
})

test('a live curated name always decides before a merged spelling', () => {
  // "Malir" is live; "johar" only names a merged area — Malir wins as before.
  assert.equal(resolveAreaHub('Karachi', 'Garden - Malir & johar campus', CURATED, ALIASES)?.area, 'Malir')
  // "Johar Mor" is its own live area; it is not swallowed by the Johar merge.
  assert.equal(resolveAreaHub('Karachi', 'Johar Mor', CURATED, ALIASES)?.area, 'Johar Mor')
  // Without aliases nothing new matches.
  assert.equal(resolveAreaHub('Karachi', 'Lal Flats Near johar Morr', CURATED, null), null)
  // A spelling whose area is retired is ignored.
  assert.equal(resolveAreaHub('Karachi', 'near xyz gulshan', ['Clifton'], ALIASES), null)
})

test("a retired area's hub moves on permanently and is never a hub", () => {
  assert.equal(hubSlugRedirect('Karachi', 'gulshan', CURATED, ALIASES), 'gulshan-e-iqbal')
  assert.equal(hubSlugRedirect('Karachi', 'johar', CURATED, ALIASES), 'gulistan-e-johar')
  assert.equal(areaHubSlug('Gulshan-e-Iqbal', 'Karachi'), 'gulshan-e-iqbal')
  // The sitemap and every chip are built from areaHubsFor — no retired slug.
  const slugs = areaHubsFor('Karachi', ['Gulshan', 'Gulshan', 'Gulshan', 'Johar', 'Johar', 'Johar'], CURATED, ALIASES).map((h) => h.slug)
  assert.deepEqual(slugs.sort(), ['gulistan-e-johar', 'gulshan-e-iqbal'])
  // The proxy answers a permanent redirect.
  assert.match(readFileSync('proxy.ts', 'utf8'), /areaHubRedirectPath[\s\S]{0,300}NextResponse\.redirect\(target, 301\)/)
  // Sitemap hubs come from the same city pages.
  assert.match(readFileSync('lib/sitemaps.ts', 'utf8'), /cityPages\(\)/)
})

test('"Keep as its own area" is refused for every role but the Owner', () => {
  for (const r of ['admin', 'operations', 'tuitions_staff', 'partner'] as const) assert.equal(canApprove(r), false, r)
  assert.equal(canApprove('owner'), true)
  const route = readFileSync('app/api/admin/locations/area/route.ts', 'utf8')
  assert.ok(route.indexOf('refuseUnlessOwnerApproval') > 0)
  assert.ok(route.indexOf('refuseUnlessOwnerApproval') < route.indexOf('keepStaffArea({'), 'checked before any write')
  assert.equal(keepAreaProblem('Gurumandir', 'Near Blue Ribbon'), null)
  assert.equal(keepAreaProblem('', ''), null, 'name optional')
  assert.ok(keepAreaProblem('x'.repeat(81), ''))
  assert.ok(keepAreaProblem('Gurumandir', 'x'.repeat(121)))
})

test('heading, chips and bulk buttons come from one count; bulk disabled at 0', () => {
  const v0 = reviewCountsView({ same: 0, notArea: 0, add: 0, aliases: 4, ignored: 2 })
  assert.equal(v0.heading, 'Typed by tutors and parents (0)')
  assert.equal(v0.tabs[0].n, 0)
  assert.ok(v0.bulk.every((b) => b.disabled), 'all bulk buttons disabled at 0')
  const v = reviewCountsView({ same: 3, notArea: 0, add: 5, aliases: 0, ignored: 0 })
  assert.equal(v.heading, 'Typed by tutors and parents (8)')
  assert.equal(v.tabs.find((t) => t.id === 'all')!.n, 8)
  assert.deepEqual(
    v.bulk.map((b) => [b.id, b.disabled]),
    [
      ['same', false],
      ['not_area', true],
      ['add', false],
    ],
  )
  assert.ok(reviewCountsView({ same: 1, notArea: 1, add: 1, aliases: 0, ignored: 0 }, true).bulk.every((b) => b.disabled), 'disabled while busy')
  // The page no longer renders its own (stale) heading.
  assert.ok(!readFileSync('app/admin/seo/locations/page.tsx', 'utf8').includes('Typed by tutors and parents ('))
})

test('a suggestion never cuts a multi-word place name in half', () => {
  const K = ['North Town', 'Clifton', 'Saddar', 'Lyari', 'Federal B Area']
  assert.equal(splitAreaLandmark('Karachi', 'North Town Residency, Gadap Town', K), null)
  assert.equal(splitAreaLandmark('Karachi', 'North Town Residency Gadap Town', K), null)
  assert.deepEqual(splitAreaLandmark('Karachi', 'Clifton Block 8', K), { area: 'Clifton', landmark: 'Block 8' })
  assert.deepEqual(splitAreaLandmark('Karachi', 'Saddar Near Taj Complex', K), { area: 'Saddar', landmark: 'Near Taj Complex' })
  assert.deepEqual(splitAreaLandmark('Karachi', 'Federal B Area, Azizabad', K), { area: 'Federal B Area', landmark: 'Azizabad' })
  assert.deepEqual(splitAreaLandmark('Karachi', 'Near Chowk Gul Muhammad Lyari', K), { area: 'Lyari', landmark: 'Near Chowk Gul Muhammad' })
})

test('the short-name report', () => {
  const c = shortNameCandidates(
    'Karachi',
    [
      { name: 'Gulshan', count: 3 },
      { name: 'Nazimabad', count: 10 },
      { name: 'North Nazimabad', count: 22 },
    ],
    ['Gulshan', 'Gulshan-e-Iqbal', 'Nazimabad', 'North Nazimabad', 'Clifton'],
  )
  assert.deepEqual(
    c.map((x) => `${x.short}~${x.longer}`),
    ['Nazimabad~North Nazimabad', 'Gulshan~Gulshan-e-Iqbal'],
  )
})

test('My sign-ups "This month" is the people Team activity counts', () => {
  const NOW = Date.parse('2026-10-16T10:00:00Z')
  const acc = (id: string, role: 'tutor' | 'parent', signed: string, paid?: string): CreditedAccount => ({
    memberId: id,
    staffId: 's',
    role,
    name: id,
    mobile: null,
    at: { signed_up: signed, ...(paid ? { paid } : {}) },
  })
  const accounts = [
    acc('a', 'tutor', '2026-10-15T08:00:00Z'),
    acc('b', 'tutor', '2026-10-15T09:00:00Z', '2026-10-15T12:00:00Z'),
    acc('c', 'parent', '2026-10-16T06:00:00Z'),
    acc('d', 'tutor', '2026-09-20T06:00:00Z', '2026-10-02T06:00:00Z'), // paid this month, signed up last month
    acc('e', 'tutor', '2026-09-21T06:00:00Z'), // last month, not paid: not this month
  ]
  const rows = accounts.map(
    (a) => ({ memberId: a.memberId, kind: 'credit', signedUpAt: a.at.signed_up ?? null, paidAt: a.at.paid ?? null, role: a.role, name: a.name, counted: !!a.at.paid }) as unknown as MySignupRow,
  )
  const v = myMonthView(accounts, '2026-10')
  assert.deepEqual(v.inProgress, { tutors: 1, parents: 1 })
  assert.equal(v.paid, 2)
  assert.equal(v.count, 4)
  assert.equal(filterRows(rows, { ...EMPTY_FILTERS, month: 'this' }, NOW).length, v.count)
  assert.equal(filterRows(rows, EMPTY_FILTERS, NOW).length, 5, 'the list itself is all time')
})
