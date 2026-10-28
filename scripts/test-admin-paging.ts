// npx tsx --test scripts/test-admin-paging.ts
//
// Admin lists load 25 at a time with "Load more", with counts and filters
// computed on the server; search still covers everything (owner, 28 Oct 2026).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { ADMIN_PAGE_MAX, ADMIN_PAGE_SIZE, pageSlice, shownCount, shownLine, withShown } from '../lib/adminPagingCore'
import { gridHref, gridSearchMatches, gridView, pickChips, pickDocFilter, type ChipRowSpec } from '../lib/cardGridPagingCore'
import { applicationsView } from '../lib/applicationsPagingCore'
import { DAY_MS, type Stage } from '../lib/applicationStageCore'
import type { DocSummaryKind } from '../lib/tutorDocSummaryCore'

const read = (f: string) => readFileSync(f, 'utf8')

// ------------------------------------------------------------ adminPagingCore

test('shownCount: 25 by default, whole pages only, never above the cap', () => {
  assert.equal(ADMIN_PAGE_SIZE, 25)
  assert.equal(shownCount(undefined), 25)
  assert.equal(shownCount(''), 25)
  assert.equal(shownCount('abc'), 25)
  assert.equal(shownCount('10'), 25)
  assert.equal(shownCount('50'), 50)
  assert.equal(shownCount('51'), 75)
  assert.equal(shownCount(['75', '100']), 75)
  assert.equal(shownCount('999999'), ADMIN_PAGE_MAX)
})

test('pageSlice: the first rows, what is left, and the next ?n=', () => {
  const all = Array.from({ length: 60 }, (_, i) => i)
  const a = pageSlice(all, 25)
  assert.equal(a.rows.length, 25)
  assert.equal(a.total, 60)
  assert.equal(a.more, 35)
  assert.equal(a.nextN, 50)
  const b = pageSlice(all, 75)
  assert.equal(b.rows.length, 60)
  assert.equal(b.more, 0)
  assert.equal(b.nextN, null)
  assert.equal(shownLine(a, 'tutors'), 'Showing 25 of 60 tutors')
  assert.equal(shownLine(b, 'tutors'), 'All 60 tutors shown')
  assert.equal(shownLine(pageSlice([], 25), 'tutors'), 'No tutors')
})

test('withShown: keeps other values, drops n at the first page', () => {
  assert.equal(withShown('/admin/users', { tab: 'tutors', n: '50', q: 'ali' }, null), '/admin/users?tab=tutors&q=ali')
  assert.equal(withShown('/admin/users', { tab: 'tutors' }, 50), '/admin/users?tab=tutors&n=50')
  assert.equal(withShown('/admin/users', { tab: 'tutors' }, 25), '/admin/users?tab=tutors')
  assert.equal(withShown('/admin/users', {}, null), '/admin/users')
})

// --------------------------------------------------------- People (card grid)

type Card = { id: string; searchFields: (string | null)[]; searchText: string; tags: Record<string, string>; docs: { kind: DocSummaryKind; oldestUploadAt: string | null } | null }

const KINDS: DocSummaryKind[] = ['approved', 'waiting', 'rejected', 'partial', 'none']
const cards: Card[] = Array.from({ length: 80 }, (_, i) => ({
  id: `t${i}`,
  searchFields: [`Tutor ${i}`, i % 2 ? 'Lahore' : 'Karachi', null],
  searchText: `t${i}@example.com 923001234${String(i).padStart(3, '0')}`,
  tags: { paid: i % 3 === 0 ? 'paid' : 'unpaid' },
  docs: { kind: KINDS[i % KINDS.length], oldestUploadAt: `2026-10-${String((i % 27) + 1).padStart(2, '0')}T00:00:00Z` },
}))
const ROWS: ChipRowSpec[] = [{ param: 'paid', options: [{ key: 'all' }, { key: 'paid' }, { key: 'unpaid' }] }]

test('People: chip counts equal the rows each chip shows, over the whole list', () => {
  const sel = pickChips(ROWS, {})
  const v = gridView(cards, { q: '', rows: ROWS, sel, docFilter: 'all', shown: 25 })
  assert.equal(v.allCount, 80)
  assert.equal(v.rowCounts.paid.all, 80)
  for (const key of ['paid', 'unpaid']) {
    const shown = gridView(cards, { q: '', rows: ROWS, sel: { paid: key }, docFilter: 'all', shown: 2000 })
    assert.equal(shown.page.total, v.rowCounts.paid[key], key)
  }
  assert.equal(v.rowCounts.paid.paid + v.rowCounts.paid.unpaid, 80)
  // Documents counts are over what the chip rows leave.
  const paid = gridView(cards, { q: '', rows: ROWS, sel: { paid: 'paid' }, docFilter: 'all', shown: 25 })
  for (const f of ['waiting', 'approved', 'rejected', 'partial', 'none'] as const) {
    const one = gridView(cards, { q: '', rows: ROWS, sel: { paid: 'paid' }, docFilter: f, shown: 2000 })
    assert.equal(one.page.total, paid.docCounts?.[f], f)
  }
})

test('People: 25 shown with Load more when more exist', () => {
  const v = gridView(cards, { q: '', rows: ROWS, sel: { paid: 'all' }, docFilter: 'all', shown: shownCount(undefined) })
  assert.equal(v.page.rows.length, 25)
  assert.equal(v.page.more, 55)
  assert.equal(v.page.nextN, 50)
  const more = gridView(cards, { q: '', rows: ROWS, sel: { paid: 'all' }, docFilter: 'all', shown: shownCount('50') })
  assert.equal(more.page.rows.length, 50)
  assert.deepEqual(more.page.rows.slice(0, 25), v.page.rows)
})

test('People: the search finds cards beyond the first 25, by name, city, email or 4+ mobile digits', () => {
  const byName = gridView(cards, { q: 'Tutor 77', rows: ROWS, sel: { paid: 'all' }, docFilter: 'all', shown: 25 })
  assert.deepEqual(byName.page.rows.map((c) => c.id), ['t77'])
  assert.equal(byName.searchedCount, 1)
  const byEmail = gridView(cards, { q: 'T63@EXAMPLE', rows: ROWS, sel: { paid: 'all' }, docFilter: 'all', shown: 25 })
  assert.deepEqual(byEmail.page.rows.map((c) => c.id), ['t63'])
  const byDigits = gridView(cards, { q: '1234-079', rows: ROWS, sel: { paid: 'all' }, docFilter: 'all', shown: 25 })
  assert.deepEqual(byDigits.page.rows.map((c) => c.id), ['t79'])
  assert.equal(gridSearchMatches({ searchFields: ['Ali'], searchText: '923005556677' }, '5-56'), false, 'fewer than 4 digits match text only')
  assert.equal(gridSearchMatches({ searchFields: ['Ali'], searchText: '923005556677' }, '555-66'), true)
  const city = gridView(cards, { q: 'lahore', rows: ROWS, sel: { paid: 'all' }, docFilter: 'all', shown: 25 })
  assert.equal(city.searchedCount, 40)
  assert.equal(city.rowCounts.paid.all, 40, 'chip counts are over the searched cards')
})

test('People: Waiting is oldest upload first; unknown chips fall back to the first option', () => {
  const v = gridView(cards, { q: '', rows: ROWS, sel: { paid: 'all' }, docFilter: 'waiting', shown: 2000 })
  const times = v.page.rows.map((c) => c.docs!.oldestUploadAt!)
  assert.deepEqual(times, [...times].sort())
  assert.deepEqual(pickChips(ROWS, { paid: 'nonsense' }), { paid: 'all' })
  assert.equal(pickDocFilter('nonsense'), 'all')
  assert.equal(pickDocFilter('waiting'), 'waiting')
})

test('People: a chip link keeps the tab, the search and the other chips, and goes back to 25', () => {
  const state = { keep: { tab: 'tutors', all: undefined }, q: 'ali', sel: { paid: 'paid' }, docFilter: 'waiting' as const }
  assert.equal(gridHref('/admin/users', state, ROWS, { docs: 'approved' }), '/admin/users?tab=tutors&paid=paid&docs=approved&q=ali')
  assert.equal(gridHref('/admin/users', state, ROWS, { paid: 'all' }), '/admin/users?tab=tutors&docs=waiting&q=ali')
  assert.ok(!gridHref('/admin/users', state, ROWS, { docs: 'all' }).includes('n='))
})

test('People: the page loads card facts for the shown cards only, and the grid filters nothing itself', () => {
  const tabs = read('app/admin/users/PeopleTabs.tsx')
  assert.ok(tabs.includes('const ids = view.page.rows.map((x) => x.p.id)'))
  assert.ok(tabs.includes('loadMemberCards(ids)'))
  assert.ok(tabs.includes('paged={{'))
  assert.ok(tabs.includes('staffPage.rows.map((s) =>'))
  const grid = read('components/admin/OverviewCardGrid.tsx')
  const paged = grid.slice(grid.indexOf('function PagedGrid'), grid.indexOf('function ClientGrid'))
  assert.doesNotMatch(paged, /\.filter\(\(it\)|applyDocFilter|docFilterCounts|useMemo/)
  assert.ok(paged.includes('<LoadMoreLink'))
})

// --------------------------------------------------------------- Applications

const NOW = Date.parse('2026-10-28T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const OWNER = { id: 'owner', adminRole: 'owner' }
const AQSA = { id: 'aqsa', adminRole: 'supervisor' }

type R = {
  id: string
  jobId: string
  tutorId: string
  tutorName: string
  jobRef: string | null
  jobTitle: string
  jobCity: string | null
  stage: Stage
  stageChangedAt: string | null
  ownerId: string | null
  createdAt: string
  jobCreatedAt: string | null
  followUps: []
}

// 60 tuitions, two applications each; tuitions 0–49 recent, 50–59 Older.
const apps: R[] = []
for (let j = 0; j < 60; j++) {
  for (let k = 0; k < 2; k++) {
    apps.push({
      id: `a${j}-${k}`,
      jobId: `j${j}`,
      tutorId: `tu${(j * 2 + k) % 70}`,
      tutorName: `Tutor ${(j * 2 + k) % 70}`,
      jobRef: `TM-${1000 + j}`,
      jobTitle: j === 44 ? 'Physics Teacher Required' : 'Home Tutor Required',
      jobCity: j % 2 ? 'Lahore' : 'Karachi',
      stage: k === 0 ? 'applied' : 'forwarded',
      stageChangedAt: ago(k === 0 ? 2 * DAY_MS : 1 * DAY_MS),
      ownerId: j % 3 === 0 ? 'aqsa' : j % 3 === 1 ? 'nabeel' : null,
      createdAt: ago(2 * DAY_MS),
      jobCreatedAt: ago((j >= 50 ? 40 : 3) * DAY_MS),
      followUps: [],
    })
  }
}
const names = new Map([['aqsa', 'Aqsa'], ['nabeel', 'Nabeel']])
const base = {
  rows: apps,
  nowMs: NOW,
  staffFilter: 'all',
  stageFilter: 'any' as const,
  tab: 'todo' as const,
  view: 'tuition' as const,
  q: '',
  shown: 25,
  olderShown: 25,
  viewedShown: 25,
  forwardCards: [] as { jobId: string; state: { tab: string } }[],
  names,
  actor: OWNER,
}

test('Applications: 25 tuition groups shown, Load more when more exist, Older pages on its own', () => {
  const v = applicationsView(base)
  // Applied rows are due (To do); Forwarded rows were moved a day ago (Sent).
  assert.equal(v.counts.todo, 50)
  assert.equal(v.counts.sent, 50)
  assert.equal(v.counts.older, 20)
  assert.equal(v.groups.total, 50)
  assert.equal(v.groups.rows.length, 25)
  assert.equal(v.groups.nextN, 50)
  assert.equal(v.older.total, 10)
  assert.equal(v.olderRowCount, 20)
  const more = applicationsView({ ...base, shown: 50 })
  assert.equal(more.groups.rows.length, 50)
  assert.deepEqual(more.groups.rows.slice(0, 25).map((g) => g.key), v.groups.rows.map((g) => g.key))
  // Each shown group carries every application of its tuition (the count line).
  for (const g of v.groups.rows) assert.equal(v.related[g.key].length, 2)
  assert.ok(!Object.keys(v.related).includes('j49') || v.groups.rows.some((g) => g.key === 'j49'))
})

test('Applications: tab and stage chip counts equal what each shows, within the Staff filter', () => {
  const mine = applicationsView({ ...base, staffFilter: 'aqsa', actor: AQSA })
  const aqsaRecent = apps.filter((a) => a.ownerId === 'aqsa' && Number(a.jobId.slice(1)) < 50)
  assert.equal(mine.counts.todo + mine.counts.sent, aqsaRecent.length)
  assert.equal(mine.stageCounts.any, mine.counts.todo)
  assert.equal(mine.stageCounts.applied, mine.counts.todo)
  const appliedOnly = applicationsView({ ...base, staffFilter: 'aqsa', actor: AQSA, stageFilter: 'applied', shown: 2000 })
  assert.equal(appliedOnly.groups.rows.reduce((n, g) => n + g.rows.length, 0), mine.stageCounts.applied)
  const sent = applicationsView({ ...base, staffFilter: 'aqsa', actor: AQSA, tab: 'sent', shown: 2000 })
  assert.equal(sent.groups.rows.reduce((n, g) => n + g.rows.length, 0), mine.counts.sent)
  assert.equal(sent.older.total, 0, 'Older sits under To do only')
  // The Staff dropdown counts the whole board.
  assert.equal(mine.choices[0].count, apps.length)
})

test('Applications: the search finds rows beyond the first 25, across tabs, Older and every staff member', () => {
  const v = applicationsView({ ...base, staffFilter: 'nabeel', q: 'physics' })
  assert.equal(v.searching, true)
  assert.equal(v.hitCount, 2)
  assert.deepEqual(v.groups.rows.map((g) => g.key), ['j44'])
  assert.equal(v.hitIds.length, 2)
  assert.equal(v.older.total, 0, 'no Older section while searching')
  const old = applicationsView({ ...base, q: 'TM-1055' })
  assert.deepEqual(old.groups.rows.map((g) => g.key), ['j55'], 'an Older tuition is found too')
  assert.ok(old.groups.rows[0].rows.every((r) => r.section === 'older'))
})

test('Applications: By tutor groups by tutor, 25 at a time, with each tutor\'s every application', () => {
  const v = applicationsView({ ...base, view: 'tutor' })
  assert.ok(v.groups.rows.length <= 25)
  for (const g of v.groups.rows) {
    assert.ok(g.rows.every((r) => r.tutorId === g.key))
    assert.deepEqual(v.related[g.key].map((r) => r.id).sort(), apps.filter((a) => a.tutorId === g.key).map((a) => a.id).sort())
  }
})

test('Applications: only the shown tuitions\' forward cards and the viewed-only list are sent', () => {
  const cardsIn = [
    { jobId: 'j0', state: { tab: 'to_forward' } },
    { jobId: 'j49', state: { tab: 'to_forward' } },
    ...Array.from({ length: 30 }, (_, i) => ({ jobId: `v${i}`, state: { tab: 'to_forward' } })),
  ]
  const v = applicationsView({ ...base, forwardCards: cardsIn })
  assert.equal(v.viewedOnly.total, 30)
  assert.equal(v.viewedOnly.rows.length, 25)
  const shownJobs = new Set(v.groups.rows.map((g) => g.key))
  for (const c of v.cards) assert.ok(shownJobs.has(c.jobId) || c.jobId.startsWith('v'))
  assert.equal(v.cards.filter((c) => c.jobId.startsWith('v')).length, 25)
})

test('Applications: the page works it out on the server; the client draws what it is given', () => {
  const page = read('app/admin/applications/page.tsx')
  assert.ok(page.includes('applicationsView({'))
  assert.ok(page.includes('shown: shownCount(sp.n)') && page.includes('olderShown: shownCount(sp.on)'))
  const ui = read('app/admin/applications/ApplicationsClient.tsx')
  assert.doesNotMatch(ui, /searchMatches\(|tabCounts\(|groupRows\(|staffChoices\(/)
  assert.ok(ui.includes('<LoadMoreLink shown={older.shown} total={older.total}') && ui.includes('param="on"'))
  assert.ok(ui.includes('<QueueSearch'))
})
