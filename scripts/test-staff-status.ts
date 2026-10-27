// npm run test:staffstatus — Team activity's Pending / Signed up statuses and
// the WhatsApp daily report (owner, 16 Oct 2026).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { pendingIn, signedUpIn, statusIn, type CreditedAccount } from '../lib/staffSignupsCore'
import { firstPaidAt, monthRange, type PaymentFacts } from '../lib/staffTargetsCore'
import { feePayersInRange, type FeePayment } from '../lib/overviewItemsCore'
import {
  REPORT_LIST_CAP,
  REPORT_MAX_CHARS,
  buildDailyReport,
  whatsappReportLink,
  type ReportSignup,
  type ReportTuition,
} from '../lib/dailyReportCore'

const MONTH = '2026-10'
const R = monthRange(MONTH)
const IN = '2026-10-10T08:00:00.000Z'

function acct(id: string, role: 'tutor' | 'parent', at: CreditedAccount['at']): CreditedAccount {
  return { memberId: id, staffId: 's1', role, name: id, mobile: null, at }
}

test('a tutor who finished onboarding but has not paid is Pending, not Signed up', () => {
  const a = acct('t-onboarded', 'tutor', { signed_up: IN, mobile_verified: IN, onboarded: IN, paid: null })
  assert.deepEqual(pendingIn([a], 'tutor', R).map((x) => x.memberId), ['t-onboarded'])
  assert.equal(signedUpIn([a], 'tutor', R).length, 0)
})

test('a paid tutor is Signed up, not Pending', () => {
  const a = acct('t-paid', 'tutor', { signed_up: IN, mobile_verified: IN, onboarded: IN, paid: IN })
  assert.deepEqual(signedUpIn([a], 'tutor', R).map((x) => x.memberId), ['t-paid'])
  assert.equal(pendingIn([a], 'tutor', R).length, 0)
  // Paid in an earlier month: Signed up then, never Pending now.
  const old = acct('t-old', 'tutor', { signed_up: '2026-09-01T08:00:00.000Z', onboarded: IN, paid: '2026-09-02T08:00:00.000Z' })
  assert.equal(statusIn([old], 'tutor', 'pending', R).length, 0)
  assert.equal(statusIn([old], 'tutor', 'signed_up', R).length, 0)
})

test('a parent who posted but did not buy a plan is Pending; a plan purchase is Signed up', () => {
  const p1 = acct('p-posted', 'parent', { signed_up: IN, posted: IN, paid: null })
  const p2 = acct('p-plan', 'parent', { signed_up: IN, paid: IN })
  assert.deepEqual(pendingIn([p1, p2], 'parent', R).map((x) => x.memberId), ['p-posted'])
  assert.deepEqual(signedUpIn([p1, p2], 'parent', R).map((x) => x.memberId), ['p-plan'])
})

test("the page's paid tutors match the dashboard's paid rule for the same period", () => {
  type Row = FeePayment & PaymentFacts & { userId: string }
  const pay = (userId: string, approvedAt: string | null, extra: Partial<Row> = {}): Row => ({
    userId,
    planCode: 'verified',
    status: 'approved',
    approvedAt,
    refundedAmountPkr: null,
    refundedAt: null,
    ...extra,
  })
  const rows: Row[] = [
    pay('a', '2026-10-03T05:00:00.000Z'),
    pay('b', '2026-10-12T05:00:00.000Z'),
    pay('c', '2026-10-14T05:00:00.000Z', { refundedAmountPkr: 199, refundedAt: '2026-10-15T00:00:00.000Z' }),
    pay('d', '2026-09-20T05:00:00.000Z'),
    pay('e', '2026-10-15T05:00:00.000Z'),
  ]
  const accounts = ['a', 'b', 'c', 'd', 'e'].map((id) =>
    acct(id, 'tutor', { signed_up: IN, paid: firstPaidAt(rows.filter((r) => r.userId === id), 'tutor') }),
  )
  const page = signedUpIn(accounts, 'tutor', R).map((a) => a.memberId).sort()
  const dashboard = feePayersInRange(rows, R.start, R.end).map((r) => r.userId).sort()
  assert.deepEqual(page, dashboard)
  assert.deepEqual(page, ['a', 'b', 'e'])
})

const tuition = (i: number): ReportTuition => ({ ref: `TM-${2000 + i}`, subject: 'Mathematics, Physics', area: 'Gulshan-e-Iqbal', fee: 'Rs 15,000–20,000' })
const signup = (i: number): ReportSignup => ({ name: `Member Number ${i}`, role: i % 2 ? 'parent' : 'tutor', staff: 'Aqsa Mughal' })

test('the WhatsApp link is correctly URL-encoded and decodes back to the message', () => {
  const text = buildDailyReport('16 Oct 2026', [tuition(1)], [{ name: 'Ali & Sons?', role: 'tutor', staff: 'Zubia #1' }])
  const href = whatsappReportLink(text)
  assert.ok(href.startsWith('https://wa.me/923215872222?text=') || href.startsWith('https://api.whatsapp.com/send?phone=923215872222&text='))
  const q = href.split(/[?&]text=/)[1]
  assert.ok(!/[\s&?#]/.test(q), 'no raw space, newline, & ? or # in the encoded text')
  assert.ok(q.includes('%0A'))
  assert.equal(decodeURIComponent(q), text)
  assert.ok(text.includes('Tuitions posted today: 1'))
  assert.ok(text.includes('TM-2001 · Mathematics, Physics · Gulshan-e-Iqbal · Rs 15,000–20,000'))
  assert.ok(text.includes('Signed up today: 1'))
  assert.ok(text.includes('Ali & Sons? · Tutor · Zubia #1'))
})

test('an empty section prints its heading with "none"', () => {
  const text = buildDailyReport('16 Oct 2026', [], [])
  assert.ok(text.includes('Tuitions posted today: none'))
  assert.ok(text.includes('Signed up today: none'))
})

test('a quiet day lists everything and stays under the limit', () => {
  const text = buildDailyReport('16 Oct 2026', [1, 2, 3].map(tuition), [1, 2].map(signup))
  assert.ok(text.length < REPORT_MAX_CHARS)
  assert.ok(!text.includes('more'))
  assert.ok(text.includes('TM-2003'))
})

test('a busy day truncates with an accurate "and N more" line and stays under 1,500 characters', () => {
  const T = 40
  const S = 30
  const text = buildDailyReport('16 Oct 2026', Array.from({ length: T }, (_, i) => tuition(i)), Array.from({ length: S }, (_, i) => signup(i)))
  assert.ok(text.length < REPORT_MAX_CHARS, `length ${text.length}`)
  assert.ok(text.includes(`Tuitions posted today: ${T}`))
  assert.ok(text.includes(`Signed up today: ${S}`))
  const [tPart, sPart] = text.split('Signed up today:')
  const tShown = (tPart.match(/^TM-\d+/gm) ?? []).length
  const sShown = (sPart.match(/^Member Number/gm) ?? []).length
  assert.ok(tShown > 0 && tShown <= REPORT_LIST_CAP)
  assert.ok(sShown > 0 && sShown <= REPORT_LIST_CAP)
  assert.ok(tPart.includes(`…and ${T - tShown} more`))
  assert.ok(sPart.includes(`…and ${S - sShown} more`))
})

test('a moderately busy day keeps the first 15 of each when they fit', () => {
  const short = (i: number): ReportTuition => ({ ref: `TM-${i}`, subject: 'Urdu', area: 'DHA', fee: null })
  const sShort = (i: number): ReportSignup => ({ name: `N${i}`, role: 'tutor', staff: 'Ali' })
  const text = buildDailyReport('16 Oct 2026', Array.from({ length: 80 }, (_, i) => short(i)), Array.from({ length: 70 }, (_, i) => sShort(i)))
  assert.ok(text.length < REPORT_MAX_CHARS)
  assert.ok(text.includes('…and 65 more'))
  assert.ok(text.includes('…and 55 more'))
})

// ---- "Pending (unpaid)" on each target card (owner, 17 Oct 2026)
import { readFileSync } from 'node:fs'
import { cardFigures } from '../lib/staffTargetsCore'
import { pendingSplit, allUnpaid } from '../lib/staffSignupsCore'

const NOW = Date.parse('2026-10-17T10:00:00.000Z')
const paidT = (id: string) => acct(id, 'tutor', { signed_up: IN, onboarded: IN, paid: IN })
const unpaidT = (id: string) => acct(id, 'tutor', { signed_up: IN, onboarded: IN, paid: null })
const unpaidP = (id: string) => acct(id, 'parent', { signed_up: IN, paid: null })
const oldUnpaid = (id: string) => acct(id, 'tutor', { signed_up: '2026-08-05T08:00:00.000Z', paid: null })

test('a card with paid and unpaid people shows both counts', () => {
  const mine = [paidT('a'), paidT('b'), unpaidT('c'), unpaidP('d'), oldUnpaid('e')]
  const f = cardFigures(mine, MONTH, 200, NOW, '2026-10-15', true)
  assert.equal(f.pace.paid, 2)
  assert.equal(f.tutors, 2)
  assert.deepEqual(f.pending, { tutors: 1, parents: 1 })
  // "All unpaid" includes the August sign-up the month-scoped Pending leaves out.
  assert.equal(f.allUnpaid, 3)
})

test('the pace (%, bar, needed per day, status) does not move when unpaid people are added', () => {
  const base = [paidT('a'), paidT('b')]
  const more = [...base, unpaidT('c'), unpaidT('d'), unpaidP('e'), oldUnpaid('f')]
  const a = cardFigures(base, MONTH, 200, NOW, '2026-10-15', true)
  const b = cardFigures(more, MONTH, 200, NOW, '2026-10-15', true)
  assert.deepEqual(b.pace, a.pace)
  assert.equal(b.tutors + b.parents, a.tutors + a.parents)
  assert.notDeepEqual(b.pending, a.pending)
})

test("a card's Pending equals the status counts' Pending for the same staff member", () => {
  const mine = [paidT('a'), unpaidT('c'), unpaidP('d'), oldUnpaid('e')]
  const card = cardFigures(mine, MONTH, 200, NOW, null, true)
  assert.deepEqual(card.pending, pendingSplit(mine, R))
  assert.equal(card.pending.tutors, pendingIn(mine, 'tutor', R).length)
  assert.equal(card.pending.parents, pendingIn(mine, 'parent', R).length)
  assert.equal(card.allUnpaid, allUnpaid(mine).length)
  // The board builds both from the one helper.
  const lib = readFileSync('lib/staffTargets.ts', 'utf8')
  assert.ok(lib.includes('const pending = pendingSplit(mine, r)'))
  assert.ok(readFileSync('lib/staffTargetsCore.ts', 'utf8').includes('pending: pendingSplit(mine, monthRange(m))'))
})

test('the card Pending links open the filtered Pending list; wording reads as follow-up', () => {
  const tab = readFileSync('app/admin/team-activity/PaidTab.tsx', 'utf8')
  const line = tab.slice(tab.indexOf('function PendingLine'), tab.indexOf('/** "Tutors x · Parents y"'))
  assert.ok(line.includes("statusHref(card.staffId, role, 'pending', month)"))
  assert.ok(line.includes('Pending (unpaid)'))
  assert.ok(line.includes('All unpaid'))
  assert.ok(tab.includes("'Signed up but has not paid — needs follow-up'"))
  // statusHref builds the same URL the status counts use.
  assert.ok(tab.includes("new URLSearchParams({ staff: staffId, role, status, month })"))
  // Secondary: small and muted, never the big number.
  assert.ok(line.includes('text-[11px] text-gray-500'))
  assert.ok(!line.includes('text-3xl'))
})
