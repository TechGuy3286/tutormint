// npm run test:overviewtrends — Overview trend arrows, the "All unpaid" link,
// SMS "no receipt" networks and whole-name area matching (owner, 17 Oct 2026).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { dayTrend, monthTrend, pkClock, trendOf, trendWindows, windowFigures } from '../lib/overviewTrendCore'
import { allUnpaid, type CreditedAccount } from '../lib/staffSignupsCore'
import { claimRow, creditRow, filterRows, EMPTY_FILTERS, type MemberFacts } from '../lib/mySignupsCore'
import { allUnpaidHref } from '../lib/teamActivityCore'
import { NO_RECEIPT_LABEL, networkOf, noReceiptNetwork, smsAlertDecision } from '../lib/smsHealthCore'
import { areaHubsFor, resolveAreaHub } from '../lib/areaHubCore'

// Pakistan time = UTC+5. "PKT 17 Oct 2026, hh:mm" → ms.
const pk = (d: number, h: number, m = 0) => Date.UTC(2026, 9, d, h - 5, m)

// ------------------------------------------------------------ A: trends

for (const [label, h, m] of [
  ['1 am', 1, 0],
  ['noon', 12, 0],
  ['11:59 pm', 23, 59],
] as const) {
  test(`same-time-yesterday comparison at ${label}`, () => {
    const now = pk(17, h, m)
    const w = trendWindows(now)
    assert.equal(w.today.start, pk(17, 0))
    assert.equal(w.yesterdaySameTime.start, pk(16, 0))
    // Yesterday up to the same minute (inclusive), never the whole day.
    assert.equal(w.yesterdaySameTime.end, now + 1 - 86_400_000)
    const events = [
      { at: pk(16, h, m) }, // yesterday at exactly this time — counts
      { at: pk(16, h, m) + 30_000 }, // yesterday, 30 s later — does not
      { at: pk(17, 0, 0) }, // today
    ]
    const f = windowFigures(events, now)
    assert.equal(f.yesterdaySameTime, 1)
    assert.equal(f.yesterday, 2)
    assert.equal(f.today, 1)
    const t = dayTrend(f, now)
    assert.equal(t.text, '— 0% vs yesterday')
    assert.equal(t.title, `Compared with yesterday up to ${pkClock(now)}`)
  })
}

test('the clock reads in Pakistan time', () => {
  assert.equal(pkClock(pk(17, 1, 5)), '1:05 am')
  assert.equal(pkClock(pk(17, 12, 0)), '12:00 pm')
  assert.equal(pkClock(pk(17, 23, 59)), '11:59 pm')
  assert.equal(pkClock(pk(17, 0, 30)), '12:30 am')
})

test('"— vs 0" when the comparison is 0, never ▲ ∞%', () => {
  const t = trendOf(5, 0, 'yesterday', 'x')
  assert.equal(t.text, '— vs 0')
  assert.equal(t.tone, 'flat')
  assert.ok(!trendOf(0, 0, 'yesterday', 'x').text.includes('∞'))
})

test('arrows carry the sign and round to whole percent', () => {
  assert.deepEqual([trendOf(3, 2, 'yesterday', '').text, trendOf(3, 2, 'y', '').tone], ['▲ +50% vs yesterday', 'up'])
  assert.deepEqual([trendOf(1, 3, 'yesterday', '').text, trendOf(1, 3, 'y', '').tone], ['▼ −67% vs yesterday', 'down'])
})

test('revenue compares the month so far with the same point last month', () => {
  const now = pk(17, 10)
  const f = windowFigures(
    [
      { at: pk(3, 10), amount: 199 },
      { at: Date.UTC(2026, 8, 10, 5), amount: 199 }, // 10 Sep — counts for 1–17 Sep
      { at: Date.UTC(2026, 8, 25, 5), amount: 999 }, // 25 Sep — after the same point
    ],
    now,
    { amounts: true },
  )
  assert.equal(f.month, 199)
  assert.equal(f.lastMonthSamePoint, 199)
  const t = monthTrend(f, now)
  assert.equal(t.text, '— 0% vs 1–17 Sep')
  assert.ok(t.title.startsWith('Compared with 1–17 Sep up to'))
})

test('a 31st compares with all of a 30-day month', () => {
  const now = Date.UTC(2026, 9, 31, 5) // 31 Oct, 10 am PKT
  const w = trendWindows(now)
  assert.equal(w.lastMonthSamePoint.end, Date.UTC(2026, 9, 1) - 5 * 3600_000)
  assert.ok(monthTrend(windowFigures([], now), now).title.includes('1–30 Sep'))
})

test('each tutor counts once per window (two fee payments on one day)', () => {
  const now = pk(17, 12)
  const f = windowFigures([{ at: pk(17, 9), key: 'a' }, { at: pk(17, 10), key: 'a' }, { at: pk(17, 11), key: 'b' }], now)
  assert.equal(f.today, 2)
})

test('every Overview card uses the one helper and the arrow is on a white pill', () => {
  const items = readFileSync('lib/overviewItems.ts', 'utf8')
  for (const k of ["case 'revenue'", "case 'paid-today'", "case 'signups-today'", "case 'tutors'", "case 'parents'", "case 'open-tuitions'"]) {
    assert.ok(items.includes(k))
  }
  assert.ok((items.match(/windowFigures\(/g) ?? []).length >= 5)
  const page = readFileSync('app/admin/page.tsx', 'utf8')
  assert.ok(page.includes('rounded-full bg-white'))
  assert.ok(page.includes('flex flex-wrap'))
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
