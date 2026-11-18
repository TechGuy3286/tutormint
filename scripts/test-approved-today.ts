/**
 * scripts/test-approved-today.ts — PR-07 (owner, 18 Nov 2026): the "Approved
 * today" chip on People → Tutors → Approved, fee pending. INVENTED data only.
 *   1. Pakistan date boundary (00:00 PKT = 19:00 UTC the day before);
 *   2. a subset of Not followed up (due now); leaves at once after a follow-up;
 *      the card label stays all day;
 *   3. sorted first within Not followed up (before Tried to pay), then newest approval;
 *   4. the Overview row moves with the chip and is hidden at 0;
 *   5. the self-check catches Approved today outside Not followed up.
 *
 *   npm run test:approvedtoday
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { approvedOnPkDay, CHIP_HINT, FU_APPROVED_TODAY, FU_TRIED, pipelineOrder, type DocState, type PipeContact } from '../lib/tutorPipelineCore'
import { approvedTodayDue, approvedTodayLabel, pipeCardFrom, pipeDetailLine, pipeTags, withContacts, type PipeCard, type PipeDocFacts } from '../lib/tutorPipelineCardCore'
import { applyOverviewDelta, badgeDelta, chipCountShift } from '../lib/pipelineRowUpdateCore'
import { approvedTodayFromRows, countsFromRows, structuralMismatches, type CheckRow } from '../lib/peopleCountsCheckCore'
import { needsRebuild } from '../lib/adminSummaryCore'
import { OVERVIEW_ITEMS, OVERVIEW_ITEM_KEYS } from '../lib/overviewItemsCore'
import type { CardDocState } from '../lib/tutorDocQueueCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const HOUR = 3_600_000
const DAY = 24 * HOUR
// 18 Nov 2026, 10:00 PKT (05:00 UTC).
const NOW = Date.parse('2026-11-18T05:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()
// Midnight PKT that started "today" = 17 Nov 19:00 UTC.
const PK_MIDNIGHT = Date.parse('2026-11-17T19:00:00Z')

const cs = (s: DocState): CardDocState =>
  s === 'approved' ? { status: 'approved', reason: null, hasUpload: true } : { status: 'none', reason: null, hasUpload: false }
const docs = (approvedAt: number): PipeDocFacts => ({
  statuses: { cnic: cs('approved'), profilePic: cs('approved'), selfie: cs('none') },
  oldestUploadAt: null,
  approvedAt: iso(approvedAt),
})
const contact = (at: number, kind: PipeContact['kind'] = 'whatsapp', extra: Partial<PipeContact> = {}): PipeContact => ({ at: iso(at), kind, stage: 'approved', docsApproved: null, staffName: 'Staff A', ...extra })

function card(a: { approvedAt: number; contacts?: PipeContact[]; tried?: boolean; paid?: boolean; ni?: boolean; now?: number }): PipeCard {
  return pipeCardFrom({
    name: 'Invented Tutor',
    feePaid: !!a.paid,
    completion: 90,
    mobileOk: true,
    docs: docs(a.approvedAt),
    contacts: a.contacts ?? [],
    notInterested: !!a.ni,
    paused: false,
    lastActiveAt: iso(NOW),
    support: null,
    nowMs: a.now ?? NOW,
    triedToPay: a.tried,
  })
}
const row = (p: PipeCard, now = NOW, extra: Record<string, unknown> = {}): CheckRow => ({ tags: { excluded: false, ...pipeTags(p, now), ...extra }, card: p })

// ------------------------------------------------------ 1. date boundary ---

test('Pakistan date boundary: 00:00 PKT is 19:00 UTC the day before', () => {
  assert.equal(approvedOnPkDay(iso(PK_MIDNIGHT), NOW), true, 'approved at 00:00 PKT today')
  assert.equal(approvedOnPkDay(iso(PK_MIDNIGHT - 60_000), NOW), false, '23:59 PKT yesterday is not today')
  assert.equal(approvedOnPkDay(iso(PK_MIDNIGHT + 23 * HOUR), PK_MIDNIGHT + 23.5 * HOUR), true, '23:00 PKT, seen at 23:30 PKT')
  // Same UTC day, different Pakistan day: approved 18:30 UTC (23:30 PKT 17 Nov), now 20:00 UTC (01:00 PKT 18 Nov).
  assert.equal(approvedOnPkDay('2026-11-17T18:30:00Z', Date.parse('2026-11-17T20:00:00Z')), false)
  assert.equal(approvedOnPkDay(null, NOW), false)
  assert.equal(approvedOnPkDay('not a date', NOW), false)
  // The chip itself follows the boundary.
  assert.ok(approvedTodayDue(card({ approvedAt: PK_MIDNIGHT + 60_000 }), NOW))
  assert.ok(!approvedTodayDue(card({ approvedAt: PK_MIDNIGHT - 60_000 }), NOW))
})

test('the summary job rebuilds on the first run of a new Pakistan day', () => {
  const builtLateEvening = PK_MIDNIGHT - 2 * 60_000 // 23:58 PKT
  const state = { builtAt: iso(builtLateEvening), startedAt: iso(builtLateEvening), dirtyAt: null }
  assert.equal(needsRebuild(state, PK_MIDNIGHT - 60_000), false, 'same day, fresh: no rebuild')
  assert.equal(needsRebuild(state, PK_MIDNIGHT + 60_000), true, 'past midnight PKT: rebuild')
})

// --------------------------------------------------- 2. subset and leaving ---

test('Approved today ⊆ Not followed up (due now); fee paid or Not interested are never in it', () => {
  const fresh = card({ approvedAt: NOW - HOUR })
  assert.equal(fresh.section, 'not')
  assert.ok(approvedTodayDue(fresh, NOW))
  const t = pipeTags(fresh, NOW)
  assert.ok(t.fus.includes('not') && t.fus.includes(FU_APPROVED_TODAY))
  assert.ok(!approvedTodayDue(card({ approvedAt: NOW - HOUR, paid: true }), NOW), 'paid tutors are not in Approved, fee pending')
  assert.ok(!approvedTodayDue(card({ approvedAt: NOW - HOUR, ni: true }), NOW), 'Not interested is never in the chips')
  assert.ok(!approvedTodayDue(card({ approvedAt: NOW - 2 * DAY }), NOW), 'approved two days ago')
})

test('a follow-up takes them out of the chip at once; the label stays all day', () => {
  const fresh = card({ approvedAt: NOW - HOUR })
  const after = withContacts(fresh, [contact(NOW - 60_000)], NOW)
  assert.equal(after.section, 'done')
  assert.ok(!approvedTodayDue(after, NOW))
  assert.ok(!pipeTags(after, NOW).fus.includes(FU_APPROVED_TODAY))
  assert.ok(approvedTodayLabel(after, NOW), 'the card still says Approved today')
  // The instant count shift on the Approved stage view.
  const shift = chipCountShift(fresh, after, { stage: 'approved', fu: FU_APPROVED_TODAY, ni: false })
  assert.equal(shift.fu[FU_APPROVED_TODAY], -1)
  assert.equal(shift.fu.not, -1)
  // A "No answer" call is an attempt, not a follow-up: they stay.
  const attempt = withContacts(fresh, [contact(NOW - 60_000, 'call', { attempt: 'no_answer' })], NOW)
  assert.equal(attempt.section, 'not')
  assert.ok(approvedTodayDue(attempt, NOW), 'an attempt does not take them out')
  // Tomorrow the label and the chip are gone.
  assert.ok(!approvedTodayLabel(fresh, NOW + DAY))
  assert.ok(!pipeTags(fresh, NOW + DAY).fus.includes(FU_APPROVED_TODAY))
})

test('the detail line does not repeat "Approved today" beside the label', () => {
  const fresh = card({ approvedAt: NOW - HOUR })
  assert.equal(pipeDetailLine(fresh, NOW), null)
  assert.match(pipeDetailLine(card({ approvedAt: NOW - 3 * DAY }), NOW) ?? '', /Approved 3 days ago/)
})

// --------------------------------------------------------------- 3. order ---

test('sorted first within Not followed up: Approved today, then Tried to pay, then newest approval', () => {
  const sortable = (id: string, p: PipeCard) => ({
    id,
    stage: p.stage,
    section: p.section,
    paused: false,
    lastActiveAt: iso(NOW),
    approvedAt: p.approvedAt ?? null,
    lastContactAt: p.lastContact?.at ?? null,
    triedToPay: !!p.triedToPay,
    approvedTodayDue: approvedTodayDue(p, NOW),
  })
  const rows = [
    sortable('old', card({ approvedAt: NOW - 5 * DAY })),
    sortable('tried', card({ approvedAt: NOW - 4 * DAY, tried: true })),
    sortable('today-early', card({ approvedAt: PK_MIDNIGHT + HOUR })),
    sortable('yesterday', card({ approvedAt: NOW - DAY })),
    sortable('today-late', card({ approvedAt: NOW - HOUR })),
  ]
  assert.deepEqual(
    pipelineOrder(rows, NOW).map((r) => r.id),
    ['today-late', 'today-early', 'tried', 'yesterday', 'old'],
  )
})

// ------------------------------------------------- 4. Overview to-do row ---

test('the Overview row "Approved today, not contacted" moves with the chip and is hidden at 0', () => {
  assert.ok(OVERVIEW_ITEM_KEYS.includes('todo-approved-today'))
  assert.equal(OVERVIEW_ITEMS['todo-approved-today'].title, 'Approved today, not contacted')
  const page = read('app/admin/page.tsx')
  const start = page.indexOf('const TODO_KEYS')
  const todo = page.slice(start, page.indexOf('const STEP_KEYS', start))
  assert.ok(todo.indexOf("'todo-approved-today'") > 0 && todo.indexOf("'todo-approved-today'") < todo.indexOf("'todo-fee-pending'"), 'near the top of Today’s to-do')
  assert.match(page, /\.filter\(\(r\) => r\.count > 0\)/, 'to-do rows with 0 are hidden')
  // The fixed section order is untouched.
  assert.match(read('lib/overviewOrderCore.ts'), /'cards',[^]*'todo',[^]*'team',[^]*'signupToPayment',[^]*'dailyFunnel',[^]*'sources'/)

  const fresh = card({ approvedAt: NOW - HOUR })
  const after = withContacts(fresh, [contact(NOW - 60_000)], NOW)
  const d = badgeDelta(fresh, after, NOW)
  assert.equal(d.approvedToday, -1)
  const moved = applyOverviewDelta({ 'todo-approved-today': { count: 1 }, 'todo-fee-pending': { count: 4 } }, d)
  assert.equal(moved?.['todo-approved-today']?.count, 0)
  assert.equal(moved?.['todo-fee-pending']?.count, 3)
  assert.equal(badgeDelta(fresh, after, NOW, false).approvedToday, 0, 'staff/test cards never move a count')
})

// ---------------------------------------------------------- 5. self-check ---

test('the self-check: Approved today ⊆ Not followed up, chip = cards, and a bad tag is caught', () => {
  const rows: CheckRow[] = [
    row(card({ approvedAt: NOW - HOUR })),
    row(card({ approvedAt: PK_MIDNIGHT + 2 * HOUR, tried: true })),
    row(card({ approvedAt: NOW - HOUR, contacts: [contact(NOW - 60_000)] })),
    row(card({ approvedAt: NOW - 3 * DAY })),
    row(card({ approvedAt: NOW - HOUR }), NOW, { excluded: true }), // test account — not counted
  ]
  assert.deepEqual(structuralMismatches(rows), [])
  const k = countsFromRows(rows)
  assert.equal(k.fu.approved[FU_APPROVED_TODAY], 2)
  assert.ok(k.fu.approved[FU_APPROVED_TODAY] <= k.fu.approved.not)
  assert.ok(k.fu.approved[FU_TRIED] <= k.fu.approved.not)
  assert.equal(approvedTodayFromRows(rows, NOW), 2)
  // A row tagged Approved today but not Not followed up is reported.
  const broken = [...rows, { tags: { excluded: false, stages: ['approved'], fus: ['done', 'f1', FU_APPROVED_TODAY] }, card: null } as CheckRow]
  assert.ok(structuralMismatches(broken).some((m) => /Approved today/.test(m.check)))
  // The production self-check carries the same rule.
  const report = read('scripts/report-people-counts-check.ts')
  assert.match(report, /Approved today ⊆ Not followed up/)
  assert.match(report, /Overview approved today = the chip/)
})

test('the chip has a one-line tooltip and sits beside Tried to pay', () => {
  assert.match(CHIP_HINT.approvedToday, /approved today/i)
  assert.match(CHIP_HINT.approvedToday, /first follow-up/i)
  const q = read('lib/peopleListQuery.ts')
  assert.ok(q.indexOf('FU_APPROVED_TODAY_LABEL, hint: CHIP_HINT.approvedToday') > 0)
})
