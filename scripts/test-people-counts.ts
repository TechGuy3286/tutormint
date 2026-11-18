/**
 * scripts/test-people-counts.ts — PR-02 (owner, 16 Nov 2026): every People
 * chip count is correct, logical and instant. INVENTED data only.
 *   1. the stages add up to All, the follow-up chips to their stage, and
 *      Tried to pay ⊆ Not followed up (due now);
 *   2. a follow-up logged from any view moves the card, the chip counts, the
 *      badge and the Overview figures at once (no refresh);
 *   3. Tried to pay lists only due-now people; they return when due;
 *   4. numbering restarts at 1 on a stage change; "No answer" never counts;
 *      contacts before the stage and repeat taps the same day are not extra
 *      follow-ups;
 *   5. any logged change (upload, payment, decision) syncs the stored card;
 *      every chip has a one-line tooltip.
 *
 *   npm run test:peoplecounts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  CHIP_HINT,
  FOLLOW_STAGES,
  FU_BUCKETS,
  FU_TRIED,
  followState,
  PIPE_STAGES,
  type DocState,
  type PipeContact,
} from '../lib/tutorPipelineCore'
import { feePendingDue, pipeCardFrom, pipeTags, triedToPayDue, withContacts, type PipeCard, type PipeDocFacts } from '../lib/tutorPipelineCardCore'
import { applyBadgeDelta, applyOverviewDelta, badgeDelta, cardInView, chipCountShift, shiftCounts, type ChipView } from '../lib/pipelineRowUpdateCore'
import { compare, countsFromRows, feePendingFromRows, structuralMismatches, type CheckRow } from '../lib/peopleCountsCheckCore'
import { peopleListQuery } from '../lib/peopleListQuery'
import type { CardDocState } from '../lib/tutorDocQueueCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const DAY = 86_400_000
const T0 = Date.parse('2026-11-16T06:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

function cs(s: DocState, reason: string | null = null): CardDocState {
  if (s === 'approved') return { status: 'approved', reason: null, hasUpload: true }
  if (s === 'waiting') return { status: 'pending', reason, hasUpload: true }
  if (s === 'rejected') return { status: 'rejected', reason, hasUpload: true }
  return { status: 'none', reason: null, hasUpload: false }
}
const docs = (cnic: DocState, photo: DocState, extra: Partial<PipeDocFacts> = {}): PipeDocFacts => ({
  statuses: { cnic: cs(cnic, cnic === 'rejected' ? 'blurry' : null), profilePic: cs(photo), selfie: cs('none') },
  oldestUploadAt: null,
  approvedAt: cnic === 'approved' && photo === 'approved' ? iso(T0 - 3 * DAY) : null,
  rejectedAt: cnic === 'rejected' ? iso(T0 - 5 * DAY) : null,
  ...extra,
})
const c = (at: number, kind: PipeContact['kind'], stage: PipeContact['stage'] = null, extra: Partial<PipeContact> = {}): PipeContact => ({
  at: iso(at),
  kind,
  stage,
  docsApproved: null,
  staffName: 'Staff A',
  ...extra,
})
function card(a: { d?: PipeDocFacts; contacts?: PipeContact[]; paid?: boolean; tried?: boolean; ni?: boolean; now?: number; noMobile?: boolean }): PipeCard {
  return pipeCardFrom({
    name: 'Invented Tutor',
    feePaid: !!a.paid,
    completion: 90,
    mobileOk: !a.noMobile,
    docs: a.d ?? docs('approved', 'approved'),
    contacts: a.contacts ?? [],
    notInterested: !!a.ni,
    paused: false,
    lastActiveAt: iso(T0),
    support: null,
    nowMs: a.now ?? T0,
    triedToPay: a.tried,
  })
}
const row = (p: PipeCard, extra: Record<string, unknown> = {}): CheckRow => ({ tags: { excluded: false, ...pipeTags(p), ...extra }, card: p })

/** An invented directory: every stage, follow-up number, tried-to-pay, NI,
 *  test and deleted accounts. */
function directory(now = T0): CheckRow[] {
  const rows: CheckRow[] = []
  rows.push(row(card({ d: docs('none', 'none'), now })))
  rows.push(row(card({ d: docs('none', 'approved'), contacts: [c(now - DAY, 'whatsapp', 'missing')], now })))
  rows.push(row(card({ d: docs('waiting', 'approved'), now })))
  rows.push(row(card({ d: docs('rejected', 'approved'), now })))
  rows.push(row(card({ d: docs('rejected', 'approved', { statuses: { cnic: cs('waiting', 'blurry'), profilePic: cs('approved'), selfie: cs('none') } }), now })))
  rows.push(row(card({ now }))) // approved, never contacted
  rows.push(row(card({ tried: true, now }))) // tried, due
  rows.push(row(card({ tried: true, contacts: [c(now - 60_000, 'whatsapp', 'approved')], now }))) // tried, followed up
  rows.push(row(card({ contacts: [c(now - DAY, 'whatsapp', 'approved')], now }))) // 1st
  rows.push(row(card({ contacts: [c(now - 2.5 * DAY, 'whatsapp', 'approved'), c(now - DAY, 'voice', 'approved')], now }))) // 2nd
  rows.push(row(card({ contacts: [c(now - 2.9 * DAY, 'whatsapp', 'approved'), c(now - 2 * DAY, 'voice', 'approved'), c(now - DAY, 'call', 'approved')], now }))) // 3rd
  rows.push(row(card({ noMobile: true, now })))
  rows.push(row(card({ paid: true, now })))
  rows.push(row(card({ ni: true, now }), { ni: true })) // Not interested
  rows.push(row(card({ now }), { excluded: true })) // test / staff
  rows.push(row(card({ now }), { excluded: true, deleted: true })) // deleted
  return rows
}

// ------------------------------------------------- 1. sums and subsets ---

test('stages add up to All; follow-up chips add up to their stage; Tried ⊆ Not followed up', () => {
  const rows = directory()
  assert.deepEqual(structuralMismatches(rows), [])
  const k = countsFromRows(rows)
  assert.equal(k.all, 13, 'NI, test and deleted are not in All')
  assert.equal(PIPE_STAGES.reduce((n, s) => n + k.stage[s], 0), k.all)
  for (const st of FOLLOW_STAGES) assert.equal(FU_BUCKETS.reduce((n, b) => n + k.fu[st][b], 0), k.stage[st], st)
  assert.equal(k.fu.approved[FU_TRIED], 1, 'only the tried-and-due tutor')
  assert.ok(k.fu.approved[FU_TRIED] <= k.fu.approved.not)
  assert.equal(k.reuploaded, 1)
  assert.deepEqual(
    { not: k.fu.approved.not, f1: k.fu.approved.f1, f2: k.fu.approved.f2, f3: k.fu.approved.f3 },
    { not: 3, f1: 2, f2: 1, f3: 1 },
  )
  // The badge's fee-pending part IS the Approved · Not followed up chip (no-mobile included).
  assert.equal(feePendingFromRows(rows), k.fu.approved.not)
  // A broken row is caught.
  const broken = [...rows, { tags: { excluded: false, stages: ['approved'], fus: ['tried'] }, card: null }]
  assert.ok(structuralMismatches(broken).some((m) => /Tried to pay outside/.test(m.check)))
  assert.deepEqual(compare([['x', 1, 1], ['y', 2, 3]]), [{ check: 'y', expected: 2, got: 3 }])
})

// ------------------------------------- 2. instant, from every view ---

test('a follow-up logged from any view moves the card, the chips, the badge and the Overview at once', () => {
  const before = card({ tried: true })
  const after = withContacts(before, [c(T0 + 60_000, 'whatsapp', 'approved')], T0 + 120_000)
  assert.equal(after.section, 'done')
  assert.equal(after.follow?.sent, 1)
  const views: ChipView[] = [
    { stage: 'all', fu: null, ni: false },
    { stage: 'approved', fu: 'not', ni: false },
    { stage: 'approved', fu: FU_TRIED, ni: false },
    { stage: 'approved', fu: 'f1', ni: false },
    { stage: 'reuploaded', fu: null, ni: false },
    { stage: 'all', fu: null, ni: undefined }, // sign-up-day / search view
  ]
  for (const v of views) {
    const shift = chipCountShift(before, after, v)
    const was = cardInView(before, v)
    const now = cardInView(after, v)
    if (v.fu === 'not' || v.fu === FU_TRIED) {
      assert.ok(was && !now, `leaves ${v.fu}`)
      assert.equal(shift.fu.not, -1)
      assert.equal(shift.fu[FU_TRIED], -1, 'Tried to pay drops by one')
      assert.equal(shift.fu.f1, 1)
    }
    if (v.fu === 'f1') assert.ok(!was && now, 'arrives in 1st follow-up')
    if (v.stage === 'all') assert.equal(was, now, 'stays in All (its follow-up line updates in place)')
    // The stage counts never move for a follow-up.
    for (const s of PIPE_STAGES) assert.equal(shift.stage[s] ?? 0, 0)
    const counts = shiftCounts({ not: 3, f1: 2, [FU_TRIED]: 1, done: 0 }, shift.fu)
    if (v.stage === 'approved') assert.deepEqual(counts, { not: 2, f1: 3, [FU_TRIED]: 0, done: 1 })
  }
  // Badge and Overview move by the same one.
  const d = badgeDelta(before, after, T0 + 120_000)
  assert.equal(d.pipelineDue, -1)
  assert.deepEqual(applyBadgeDelta({ peopleWaiting: 2, pipelineDue: 5 } as never, d), { peopleWaiting: 2, pipelineDue: 4 })
  const ov = applyOverviewDelta({ 'todo-fee-pending': { count: 5 }, 'todo-docs': { count: 2 } }, d)
  assert.equal(ov?.['todo-fee-pending']?.count, 4)
  // A test / staff row never moves a count.
  assert.deepEqual(badgeDelta(before, after, T0, false), { pipelineDue: 0, peopleWaiting: 0, rejectedUninformed: 0, approvedToday: 0 })
  // The page keeps the saved card, so a card that stays shows its new line at once.
  const moves = read('components/admin/PipelineMoves.tsx')
  assert.match(moves, /setCards\(\(m\) => new Map\(m\)\.set\(memberId, moved\.next\)\)/)
  assert.match(read('components/admin/OverviewCardGrid.tsx'), /moves\.cardFor\(it\.memberId, it\.pipe\.card\)/)
  // A failed save brings the card back.
  assert.match(moves, /const fail = useCallback/)
})

// --------------------------------------------- 3. tried to pay ---

test('Tried to pay lists only due-now people; after a follow-up they leave; they return when due', () => {
  const due = card({ tried: true })
  assert.ok(triedToPayDue(due))
  assert.ok(pipeTags(due).fus.includes(FU_TRIED))
  const followed = withContacts(due, [c(T0, 'whatsapp', 'approved')], T0 + 60_000)
  assert.ok(!triedToPayDue(followed), 'not due after a follow-up')
  assert.ok(!pipeTags(followed).fus.includes(FU_TRIED))
  assert.equal(followed.triedToPay, true, 'the orange label stays on the card')
  const later = withContacts(due, [c(T0, 'whatsapp', 'approved')], T0 + 2 * DAY + 1)
  assert.equal(later.section, 'not')
  assert.ok(pipeTags(later).fus.includes(FU_TRIED), 'back when the next follow-up is due')
  assert.ok(!triedToPayDue(card({ tried: true, d: docs('none', 'none') })), 'only in Approved, fee pending')
  assert.ok(feePendingDue(card({ noMobile: true })), 'the badge counts the chip, no-mobile included')
})

// ------------------------------------------------- 4. numbering ---

test('numbering restarts at 1 on a stage change; No answer, earlier contacts and same-day repeats do not count', () => {
  // The bug: approved today, eight contacts from before the approval and three
  // repeat taps → "Follow-up 9 due".
  const approvedAt = T0 - 60 * 60_000
  const before = [
    c(T0 - 26 * DAY, 'whatsapp'),
    c(T0 - 25 * DAY, 'whatsapp'),
    c(T0 - 25 * DAY + 3 * 60_000, 'whatsapp'),
    c(T0 - 12 * DAY, 'whatsapp', null, { docsApproved: true }),
    c(T0 - 25 * DAY, 'call'),
  ]
  const today = [c(approvedAt - 50_000, 'whatsapp'), c(approvedAt + 5_000, 'whatsapp'), c(approvedAt + 40_000, 'whatsapp')]
  const p = card({ d: docs('approved', 'approved', { approvedAt: iso(approvedAt) }), contacts: [...before, ...today] })
  assert.equal(p.follow?.sent, 1, 'only today counts, and the three taps are one follow-up')
  assert.equal(p.follow?.nextNumber, 2)
  assert.equal(p.enteredAt, iso(approvedAt))
  // A stage change restarts at 1.
  const rej = card({ d: docs('rejected', 'approved'), contacts: [c(T0 - 10 * DAY, 'whatsapp', 'missing'), c(T0 - DAY, 'whatsapp', 'rejected')] })
  assert.equal(rej.follow?.sent, 1)
  const fresh = card({ d: docs('approved', 'approved', { approvedAt: iso(T0 - 1000) }), contacts: [c(T0 - DAY, 'whatsapp', 'rejected')] })
  assert.equal(fresh.follow?.sent, 0)
  assert.equal(fresh.follow?.nextNumber, 1)
  // "No answer" never counts — whatever its date.
  const st = followState('approved', [c(T0 - 10 * DAY, 'call', null, { attempt: 'no_answer' }), c(T0 - 60_000, 'call', null, { attempt: 'no_answer' })], T0)
  assert.equal(st.sent, 0)
  assert.equal(st.section, 'not')
  // Two different days are two follow-ups.
  assert.equal(followState('approved', [c(T0 - 3 * DAY, 'whatsapp'), c(T0 - DAY, 'voice')], T0).sent, 2)
})

// ---------------------------------- 5. every change syncs; tooltips ---

test('any logged change syncs the stored card; every chip carries its rule as a tooltip', () => {
  assert.match(read('lib/activityLog.ts'), /syncPipelineSoon\(params\.userId\)/)
  assert.match(read('lib/auditLog.ts'), /syncPipelineSoon\(params\.targetId\)/)
  assert.match(read('lib/pipelineSyncHook.ts'), /after\(run\)/)
  assert.match(read('lib/tutorPipeline.ts'), /return updatePipelineRow\(memberId, \{ kind: 'live' \}\)/)
  const lq = peopleListQuery('tutors', { tab: 'tutors', stage: 'approved' }, { showAll: false, showDeleted: false })
  for (const r of lq.rows) for (const o of r.options.filter((x) => !x.hidden)) assert.ok(o.hint && o.hint.length > 10, `${r.param}/${o.key} has a tooltip`)
  for (const k of ['ni', 'deleted', 'staffTest'] as const) assert.ok(CHIP_HINT[k])
  assert.match(read('components/admin/OverviewCardGrid.tsx'), /title=\{o\.hint\}/)
  // The Overview rows read the same rules as the badge and chips.
  const ov = read('lib/overviewItems.ts')
  assert.match(ov, /pipelineRows\(\(c\) => feePendingDue\(c\)\)/)
  assert.match(ov, /pipelineRows\(\(c\) => cardRejectedUninformed\(c\)\)/)
})
