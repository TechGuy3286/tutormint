/**
 * scripts/test-pipeline-move.ts — the People card moves at once (owner, 15 Nov
 * 2026), on INVENTED data only (nothing is read from or written to a database):
 *   1. logging a follow-up rewrites the stored People row (tags + card), moves
 *      the chip counts and the badge at once — and Undo reverses all of it;
 *   2. "Not interested" and a document decision move the row and counts too;
 *   3. the wiring: every route that logs sends the card before/after back, the
 *      page hides the card at once and brings it back when the save fails.
 *
 *   npm run test:pipelinemove
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import type { DocState, PipeContact } from '../lib/tutorPipelineCore'
import { pipeCardFrom, pipeTags, readyForReviewFrom, withContacts, type PipeCard, type PipeDocFacts } from '../lib/tutorPipelineCardCore'
import {
  applyBadgeDelta,
  badgeDelta,
  cardInView,
  cardReadyForReview,
  chipCountShift,
  mergeLiveCard,
  peopleRowFor,
  shiftCounts,
  type ChipView,
  type StoredPeopleRow,
} from '../lib/pipelineRowUpdateCore'
import type { BadgesPayload } from '../lib/adminSummaryCore'
import type { CardDocState } from '../lib/tutorDocQueueCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const DAY = 86_400_000
const T0 = Date.parse('2026-11-16T06:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

function cs(s: DocState): CardDocState {
  if (s === 'approved') return { status: 'approved', reason: null, hasUpload: true }
  if (s === 'waiting') return { status: 'pending', reason: null, hasUpload: true }
  if (s === 'rejected') return { status: 'rejected', reason: 'Blurry', hasUpload: true }
  return { status: 'none', reason: null, hasUpload: false }
}
function docs(cnic: DocState, photo: DocState, selfie: DocState = 'none'): PipeDocFacts {
  return { statuses: { cnic: cs(cnic), profilePic: cs(photo), selfie: cs(selfie) }, oldestUploadAt: iso(T0 - 5 * DAY), approvedAt: iso(T0 - 2 * DAY) }
}
function card(d: PipeDocFacts, contacts: PipeContact[] = [], extra: Partial<Parameters<typeof pipeCardFrom>[0]> = {}): PipeCard {
  return pipeCardFrom({
    name: 'Invented Tutor',
    feePaid: false,
    completion: 90,
    mobileOk: true,
    docs: d,
    contacts,
    notInterested: false,
    paused: false,
    lastActiveAt: iso(T0 - DAY),
    support: '0300 0000000',
    nowMs: T0,
    ...extra,
  })
}
const whatsapp = (at: number): PipeContact => ({ at: iso(at), kind: 'whatsapp', stage: 'approved', docsApproved: null, staffName: 'Staff A' })
const stored = (p: PipeCard): StoredPeopleRow => ({ tags: { city: 'invented-city', dupe: false, ...pipeTags(p) }, row: { name: 'Invented Tutor', pipe: p } })
const BADGES: BadgesPayload = { reports: 0, receipts: 0, peopleWaiting: 4, pipelineDue: 7, parentOverdue: 0, appsOverdue: { total: 0, byOwner: {} }, paidRed: { total: 0, byOwner: {} } }

const DUE_VIEW: ChipView = { stage: 'approved', fu: 'not', ni: false }
// What the server counted for the invented list before the change.
const SERVER = { stage: { all: 20, approved: 9, missing: 11 }, fu: { not: 7, f1: 2, f2: 0, f3: 0, done: 2 } }

test('logging a follow-up rewrites the stored row, the chip counts and the badge at once', () => {
  const prev = card(docs('approved', 'approved'))
  assert.equal(prev.stage, 'approved')
  assert.equal(prev.section, 'not')
  const next = withContacts(prev, [whatsapp(T0)], T0)

  // The stored row: pipeline tags replaced, every other tag and field kept.
  const write = peopleRowFor(stored(prev), next)
  assert.deepEqual(write.tags.fus, ['done', 'f1'])
  assert.equal(write.tags.city, 'invented-city')
  assert.equal(write.tags.dupe, false)
  assert.equal((write.row as { name: string }).name, 'Invented Tutor')
  assert.equal((write.row as { pipe: PipeCard }).pipe.follow?.sent, 1)

  // The card leaves "Not followed up" and joins "1st follow-up".
  assert.equal(cardInView(prev, DUE_VIEW), true)
  assert.equal(cardInView(next, DUE_VIEW), false)
  assert.equal(cardInView(next, { ...DUE_VIEW, fu: 'f1' }), true)

  // The chip counts move by exactly one card.
  const s = chipCountShift(prev, next, DUE_VIEW)
  assert.deepEqual(s.stage, {}) // still Approved, fee pending
  assert.deepEqual(shiftCounts(SERVER.fu, s.fu), { not: 6, f1: 3, f2: 0, f3: 0, done: 3 })

  // The sidebar badge (Approved fee pending · due now) drops by one.
  const d = badgeDelta(prev, next, T0)
  assert.deepEqual(d, { pipelineDue: -1, peopleWaiting: 0 })
  assert.equal(applyBadgeDelta(BADGES, d)?.pipelineDue, 6)
})

test('Undo puts the row, the counts and the badge back exactly', () => {
  const prev = card(docs('approved', 'approved'))
  const logged = withContacts(prev, [whatsapp(T0)], T0)
  const undone = withContacts(logged, [], T0)
  assert.deepEqual(pipeTags(undone), pipeTags(prev))
  assert.deepEqual(peopleRowFor(stored(logged), undone).tags, stored(prev).tags)
  assert.equal(cardInView(undone, DUE_VIEW), true)

  const there = chipCountShift(prev, logged, DUE_VIEW)
  const back = chipCountShift(logged, undone, DUE_VIEW)
  assert.deepEqual(shiftCounts(shiftCounts(SERVER.fu, there.fu), back.fu), SERVER.fu)
  const b1 = applyBadgeDelta(BADGES, badgeDelta(prev, logged, T0))!
  const b2 = applyBadgeDelta(b1, badgeDelta(logged, undone, T0))!
  assert.equal(b2.pipelineDue, BADGES.pipelineDue)
})

test('"Not interested" leaves the normal lists and the counts; its Undo returns it', () => {
  const prev = card(docs('approved', 'approved'))
  const marked: PipeCard = { ...prev, notInterested: true }
  assert.equal(cardInView(marked, DUE_VIEW), false)
  assert.equal(cardInView(marked, { stage: 'approved', fu: 'not', ni: true }), true)
  const s = chipCountShift(prev, marked, DUE_VIEW)
  assert.deepEqual(shiftCounts(SERVER.stage, s.stage), { all: 19, approved: 8, missing: 11 })
  assert.equal(shiftCounts(SERVER.fu, s.fu).not, 6)
  assert.equal(badgeDelta(prev, marked, T0).pipelineDue, -1)
  assert.equal(badgeDelta(marked, prev, T0).pipelineDue, 1)
})

test('a document decision moves the card to its new stage and the waiting badge', () => {
  const waitingDocs = docs('approved', 'waiting')
  const prev = card(waitingDocs)
  assert.equal(prev.stage, 'waiting')
  assert.equal(cardReadyForReview(prev), readyForReviewFrom(waitingDocs, 90))
  assert.equal(cardReadyForReview(prev), true)
  const next = mergeLiveCard(prev, card(docs('approved', 'approved')))
  assert.equal(next.stage, 'approved')
  assert.deepEqual(badgeDelta(prev, next, T0), { pipelineDue: 1, peopleWaiting: -1 })
  const view: ChipView = { stage: 'waiting', ni: false }
  assert.equal(cardInView(next, view), false)
  const s = chipCountShift(prev, next, view)
  assert.deepEqual(s.stage, { waiting: -1, approved: 1 })
  // Rejected → no longer waiting either.
  assert.equal(cardReadyForReview(card(docs('approved', 'rejected'))), false)
})

test('the live card keeps what only the summary job knows', () => {
  const storedCard: PipeCard = { ...card(docs('approved', 'approved'), [], { feePaid: true }), lastActiveAt: iso(T0 - 3 * DAY), paidAt: iso(T0 - 1 * DAY) }
  const live = card(docs('approved', 'approved'), [], { feePaid: true, paidAt: null })
  const m = mergeLiveCard(storedCard, live)
  assert.equal(m.lastActiveAt, storedCard.lastActiveAt)
  assert.equal(m.paidAt, storedCard.paidAt)
})

test('wiring: every logging route returns the moved card; the page moves it at once and back on failure', () => {
  const route = read('app/api/admin/people/follow-up/route.ts')
  assert.equal((route.match(/movedJson\(/g) ?? []).length, 3) // record, attempt, undo
  assert.match(read('app/api/admin/follow-ups/not-interested/route.ts'), /movedJson\(moved\)/)
  assert.match(read('app/api/admin/tutors/document-review/route.ts'), /updatePipelineRow\(tutorId, \{ kind: 'live' \}\)/)
  assert.match(read('app/api/admin/documents/staff-decisions/route.ts'), /updatePipelineRow\(dec\.member_id as string, \{ kind: 'live' \}\)/)
  const rec = read('lib/tutorPipelineRecord.ts')
  assert.match(rec, /const moved = await refreshPipelineRow\(a\.memberId\)/)
  assert.match(rec, /const moved = await refreshPipelineRow\(memberId\)/)
  // The stored row and badges are written in the same request.
  const tp = read('lib/tutorPipeline.ts')
  assert.match(tp, /from\('admin_list_rows'\)\.update\(write\)/)
  assert.match(tp, /await nudgeBadges\(badgeDelta\(prev, next, now\)\)/)
  // The page: the grid hides moved cards and shifts the chip counts.
  const grid = read('components/admin/OverviewCardGrid.tsx')
  assert.match(grid, /<PipelineMovesProvider/)
  assert.match(grid, /withoutMoved\(items, moves\)/)
  assert.match(read('components/admin/PipelineMoves.tsx'), /moves\.hidden\.has\(x\.memberId\)/)
  assert.match(read('app/admin/users/PeopleTabs.tsx'), /pipelineView:/)
  for (const f of ['components/admin/PipeContactButtons.tsx', 'components/admin/NotInterestedButton.tsx', 'components/admin/PipelineActions.tsx']) {
    const src = read(f)
    assert.match(src, /move\.begin\(/, f)
    assert.match(src, /move\.fail\(memberId\)/, f)
    assert.match(src, /move\.done\(memberId/, f)
  }
})
