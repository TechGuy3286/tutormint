// npm run test:overviewtrends — Overview square cards (one time-window helper), the "All unpaid" link,
// SMS "no receipt" networks and whole-name area matching (owner, 17 Oct 2026).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { cardFigures, rupees, trendWindows, windowFigures } from '../lib/overviewTrendCore'
import { allUnpaid, type CreditedAccount } from '../lib/staffSignupsCore'
import { claimRow, creditRow, filterRows, EMPTY_FILTERS, type MemberFacts } from '../lib/mySignupsCore'
import { allUnpaidHref } from '../lib/teamActivityCore'
import { NO_RECEIPT_LABEL, networkOf, noReceiptNetwork, smsAlertDecision } from '../lib/smsHealthCore'
import { areaHubsFor, resolveAreaHub } from '../lib/areaHubCore'

// Pakistan time = UTC+5. "PKT 17 Oct 2026, hh:mm" → ms.
const pk = (d: number, h: number, m = 0) => Date.UTC(2026, 9, d, h - 5, m)

// ------------------------------------------------------------ A: card windows

for (const [label, h, m] of [
  ['1 am', 1, 0],
  ['noon', 12, 0],
  ['11:59 pm', 23, 59],
] as const) {
  test(`today, yesterday and last 7 days are Pakistan calendar days at ${label}`, () => {
    const now = pk(17, h, m)
    const w = trendWindows(now)
    assert.equal(w.today.start, pk(17, 0))
    assert.equal(w.yesterday.start, pk(16, 0))
    assert.equal(w.yesterday.end, pk(17, 0))
    // Last 7 days = today and the six full days before it, from 00:00.
    assert.equal(w.last7.start, pk(11, 0))
    const events = [
      { at: pk(10, 23, 59) }, // 10 Oct, before the 7-day window
      { at: pk(11, 0, 0) }, // 11 Oct 00:00 — counts in last 7 days
      { at: pk(16, 23, 59) }, // yesterday, last minute
      { at: pk(17, 0, 0) }, // today
    ]
    const f = windowFigures(events, now)
    assert.equal(f.today, 1)
    assert.equal(f.yesterday, 1)
    assert.equal(f.last7, 3)
  })
}

test('the month starts on the 1st, Pakistan time', () => {
  const now = pk(17, 10)
  assert.equal(trendWindows(now).month.start, Date.UTC(2026, 9, 1) - 5 * 3600_000)
  const f = windowFigures([{ at: pk(1, 0), amount: 199 }, { at: Date.UTC(2026, 8, 30, 18, 59), amount: 999 }], now, { amounts: true })
  assert.equal(f.month, 199) // 30 Sep 23:59 PKT is last month
})

test('each tutor counts once per window (two fee payments on one day)', () => {
  const now = pk(17, 12)
  const f = windowFigures([{ at: pk(17, 9), key: 'a' }, { at: pk(17, 10), key: 'a' }, { at: pk(17, 11), key: 'b' }], now)
  assert.equal(f.today, 2)
})

test('card figures: thousands separators, Rs on amounts, no bottom line unless given', () => {
  assert.equal(rupees(125000), 'Rs 125,000')
  assert.equal(rupees(199.4), 'Rs 199')
  const c = cardFigures({ today: 1234, yesterday: 5, last7: 0, month: 0 })
  assert.deepEqual(c, { today: '1,234', yesterday: '5', last7: '0', bottom: null })
  const r = cardFigures({ today: 1194, yesterday: 0, last7: 2388, month: 0 }, { rupees: true, bottom: { label: 'This month', value: 'Rs 4,000' } })
  assert.deepEqual(r, { today: 'Rs 1,194', yesterday: 'Rs 0', last7: 'Rs 2,388', bottom: { label: 'This month', value: 'Rs 4,000' } })
})

test('the six cards: short titles, one helper, no pills or explanations', () => {
  const items = readFileSync('lib/overviewItems.ts', 'utf8')
  for (const k of ["case 'revenue'", "case 'paid-today'", "case 'signups-today'", "case 'tutors'", "case 'parents'", "case 'open-tuitions'"]) {
    assert.ok(items.includes(k))
  }
  assert.ok((items.match(/cardFigures\(/g) ?? []).length >= 5)
  for (const b of ["label: 'This month', value: rupees(amount)", "label: 'Total'", "label: 'Open now'"]) assert.ok(items.includes(b), b)
  const page = readFileSync('app/admin/page.tsx', 'utf8')
  for (const t of ["title: 'Revenue'", "title: 'Paid'", "title: 'New tutors'", "title: 'New parents'", "title: 'Tuitions posted'", "title: 'Signed up, not paid'"]) {
    assert.ok(page.includes(t), t)
  }
  assert.ok(page.includes('aspect-square'))
  assert.ok(page.includes('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6'))
  for (const gone of ['vs yesterday', '▲', '▼', 'Registered accounts', 'Approved this month, not refunded', 'Live on the board', 'TrendLine']) {
    assert.ok(!page.includes(gone), `page still has "${gone}"`)
  }
  assert.ok(!readFileSync('lib/overviewTrendCore.ts', 'utf8').includes('vs yesterday'))
})

// ------------------------------------------------------------ B: All unpaid

const facts = (o: Partial<MemberFacts>): MemberFacts => ({
  role: 'tutor',
  signedUpAt: '2026-09-02T08:00:00.000Z',
  mobileVerifiedAt: null,
  onboardedAt: null,
  docsSubmitted: false,
  postedAt: null,
  paidAt: null,
  refunded: false,
  ...o,
})

test('the All unpaid count matches its list', () => {
  const people: { id: string; f: MemberFacts }[] = [
    { id: 'a', f: facts({}) },
    { id: 'b', f: facts({ paidAt: '2026-10-01T08:00:00.000Z' }) },
    { id: 'c', f: facts({ role: 'parent', postedAt: '2026-10-02T08:00:00.000Z' }) },
    { id: 'd', f: facts({ refunded: true }) },
    { id: 'e', f: facts({ signedUpAt: '2026-08-01T08:00:00.000Z', onboardedAt: '2026-08-02T08:00:00.000Z' }) },
  ]
  const accounts: CreditedAccount[] = people.map((p) => ({
    memberId: p.id,
    staffId: 's1',
    role: p.f.role,
    name: p.id,
    mobile: null,
    at: { signed_up: p.f.signedUpAt, paid: p.f.paidAt },
  }))
  const rows = [
    ...people.map((p) =>
      creditRow({ memberId: p.id, staffId: 's1', name: p.id, phone: null, waNumber: null, email: null, city: null, creditedBy: 'link', facts: p.f, templateBodies: {}, siteUrl: (x) => x }),
    ),
    // A claim not credited is never one of their unpaid people.
    claimRow({ memberId: 'z', staffId: 's1', name: 'z', maskedPhone: null, role: 'tutor', claimedAt: '2026-10-01T00:00:00.000Z', status: 'pending', reason: null }),
  ]
  const card = allUnpaid(accounts).map((a) => a.memberId).sort()
  const list = filterRows(rows, { ...EMPTY_FILTERS, counted: 'not_paid', month: 'all' }, Date.UTC(2026, 9, 17)).map((r) => r.memberId).sort()
  assert.deepEqual(list, card)
  assert.deepEqual(card, ['a', 'c', 'd', 'e'])
})

test('the All unpaid link opens My sign-ups for oneself, the staff list for others', () => {
  assert.equal(allUnpaidHref('me', 'me'), '/admin/my-signups?counted=not_paid&month=all')
  assert.equal(allUnpaidHref('s1', 'owner'), '/admin/team-activity/accounts?staff=s1&unpaid=all')
  const tab = readFileSync('app/admin/team-activity/PaidTab.tsx', 'utf8')
  assert.ok(tab.includes('allUnpaidHref(card.staffId, viewerId)'))
  // Pending stays out of the pace.
  assert.ok(readFileSync('lib/staffTargetsCore.ts', 'utf8').includes('pace: paceFor(target, paid.length, m, nowMs, countingStart)'))
})

// ------------------------------------------------------------ C: SMS

test('networks from the masked number; Ufone and Zong are "no receipt"', () => {
  assert.equal(networkOf('0331•••••22'), 'Ufone')
  assert.equal(networkOf('0312•••••05'), 'Zong')
  assert.equal(networkOf('0300•••••11'), 'Jazz')
  assert.equal(networkOf('0345•••••11'), 'Telenor')
  assert.equal(noReceiptNetwork('0331•••••22'), true)
  assert.equal(noReceiptNetwork('0312•••••22'), true)
  assert.equal(noReceiptNetwork('0300•••••22'), false)
  assert.ok(NO_RECEIPT_LABEL.startsWith('Sent — no receipt from network'))
})

test('"no receipt" never fires the SMS alert', () => {
  // Ufone/Zong sends with no receipt are recorded as SENT: they are successes.
  const quiet = smsAlertDecision({ now: Date.now(), lastAlertAt: null, newFailures: 0, codeRequests12h: 8, successes12h: 8 })
  assert.equal(quiet.fire, false)
  // A real failure still fires; a sharp drop still fires.
  assert.equal(smsAlertDecision({ now: Date.now(), lastAlertAt: null, newFailures: 1, codeRequests12h: 1, successes12h: 1 }).fire, true)
  assert.equal(smsAlertDecision({ now: Date.now(), lastAlertAt: null, newFailures: 0, codeRequests12h: 8, successes12h: 1 }).fire, true)
  assert.equal(smsAlertDecision({ now: Date.now(), lastAlertAt: null, newFailures: 0, codeRequests12h: 8, successes12h: 2 }).fire, false)
  // Nothing in the alert rule can read a receipt.
  assert.ok(!/receipt/i.test(String(smsAlertDecision)))
})

// ------------------------------------------------------------ D: whole names

const KARACHI = ['Gulshan-e-Iqbal', 'Gulistan-e-Johar', 'Gulistan-e-Maymar', 'Clifton']
const KARACHI_ALIASES = { gulshan: 'Gulshan-e-Iqbal', johar: 'Gulistan-e-Johar' }
const LAHORE = ['Johar Town', 'Model Town', 'DHA Lahore']
const ALL = [...KARACHI, ...LAHORE, 'Gulshan-e-Hadeed']

test('"Gulshan" does not match "Gulshan-e-Maymar Block 3" or "Gulshan-e-Hadeed"', () => {
  assert.equal(resolveAreaHub('Karachi', 'Gulshan-e-Maymar Block 3', KARACHI, KARACHI_ALIASES, ALL), null)
  assert.equal(resolveAreaHub('Karachi', 'Gulshan-e-Hadeed', KARACHI, KARACHI_ALIASES, ALL), null)
  assert.equal(resolveAreaHub('Karachi', 'Sector L-7 Gulshan-e-Hadeed', KARACHI, KARACHI_ALIASES), null)
  assert.equal(resolveAreaHub('Karachi', 'Gulshan-e-Kaneez', KARACHI, KARACHI_ALIASES), null)
  // Still counted: the name on its own, or with plain words around it.
  assert.equal(resolveAreaHub('Karachi', 'Gulshan ( Near Muskan chowrangi)', KARACHI, KARACHI_ALIASES, ALL)?.area, 'Gulshan-e-Iqbal')
  assert.equal(resolveAreaHub('Karachi', 'Gulshan', KARACHI, KARACHI_ALIASES, ALL)?.area, 'Gulshan-e-Iqbal')
  assert.equal(resolveAreaHub('Karachi', 'Block 13- A Gulshan-e-Iqbal', KARACHI, KARACHI_ALIASES, ALL)?.area, 'Gulshan-e-Iqbal')
})

test('"Johar" (Karachi) does not match "Johar Town" (Lahore); cities never cross', () => {
  assert.equal(resolveAreaHub('Karachi', 'Johar Town', KARACHI, KARACHI_ALIASES, ALL), null)
  assert.equal(resolveAreaHub('Lahore', 'Johar Town', LAHORE, null, ALL)?.area, 'Johar Town')
  assert.equal(resolveAreaHub('Lahore', 'near Johar', LAHORE, null, ALL), null)
  assert.equal(resolveAreaHub('Karachi', 'Lal Flats Near johar Morr', KARACHI, KARACHI_ALIASES, ALL)?.area, 'Gulistan-e-Johar')
  // "Johar" is not the second half of Gulistan-e-Johar's own name match.
  assert.equal(resolveAreaHub('Karachi', 'Block 16 Gulistan-e-Johar', KARACHI, KARACHI_ALIASES, ALL)?.area, 'Gulistan-e-Johar')
  // DHA in one city never matches another city's list.
  assert.equal(resolveAreaHub('Karachi', 'DHA Phase 5', KARACHI, KARACHI_ALIASES, ALL), null)
  assert.equal(resolveAreaHub('Lahore', 'DHA Phase 5', LAHORE, null, ALL)?.area, 'DHA Lahore')
})

test('hub counts: merged names count, longer names do not', () => {
  const hubs = areaHubsFor('Karachi', ['Gulshan', 'Gulshan-e-Iqbal', 'Gulshan Block 5', 'Gulshan-e-Hadeed', 'Gulshan-e-Maymar Block 3', 'Johar Town'], KARACHI, KARACHI_ALIASES, ALL)
  assert.equal(hubs.find((h) => h.slug === 'gulshan-e-iqbal')?.count, 3)
  assert.equal(hubs.find((h) => h.slug === 'gulistan-e-johar'), undefined)
})
