/**
 * scripts/test-closest-to-pay.ts  —  npm run test:closesttopay
 *
 * Owner, 5 Nov 2026: "Closest to paying" follow-up chips, and deleted /
 * suspended / paused accounts in the work lists. Invented data only — no
 * database, no real names or numbers.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  CLOSEST_STAGES,
  closestCounts,
  closestMessage,
  closestMissing,
  closestStage,
  contactedAgo,
  isClosestTemplateKey,
  closestTemplateKey,
  sortClosest,
  type ClosestFacts,
  type DocState,
} from '../lib/closestToPayCore'
import { excludedReason, peopleFixed, sortPeople, waitingBadge } from '../lib/peopleDirectoryCore'

/** admin_list_page's p_fixed rule (jsonb containment) over a stored row's tags. */
function inTabRule(p: { excluded: unknown; deleted: boolean }, fixed: Record<string, boolean>): boolean {
  const tags: Record<string, boolean> = { excluded: p.excluded !== null, deleted: p.deleted }
  return Object.entries(fixed).every(([k, v]) => tags[k] === v)
}
import { roleSatisfies, SCREEN_ACCESS } from '../lib/adminAccessCore'
import { isMoneyItem } from '../lib/overviewMoneyCore'
import { OVERVIEW_ITEMS, OVERVIEW_ITEM_KEYS } from '../lib/overviewItemsCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const DAY = 86_400_000
const NOW = Date.parse('2026-11-05T12:00:00Z')
const ago = (d: number) => new Date(NOW - d * DAY).toISOString()

const STATES: DocState[] = ['approved', 'waiting', 'rejected', 'none']

/** The expected stage, written out the long way from the owner's words. */
function expected(f: ClosestFacts): string | null {
  if (f.feePaid) return null
  const up = (s: DocState) => s === 'approved' || s === 'waiting'
  const ready = f.cnic === 'approved' && f.photo === 'approved' && f.selfie === 'approved'
  const mainApproved = f.cnic === 'approved' && f.photo === 'approved' && f.selfie !== 'approved'
  const allUploaded = up(f.cnic) && up(f.photo) && up(f.selfie) && [f.cnic, f.photo, f.selfie].includes('waiting')
  const mainUploaded = up(f.cnic) && up(f.photo) && f.selfie === 'none'
  const matches = [ready && 'ready', mainApproved && 'main_approved', allUploaded && 'all_uploaded', mainUploaded && 'main_uploaded'].filter(Boolean)
  return (matches[0] as string) ?? null
}

test('every tutor lands in exactly one, correct, chip — hottest first', () => {
  for (const cnic of STATES)
    for (const photo of STATES)
      for (const selfie of STATES) {
        const f: ClosestFacts = { feePaid: false, cnic, photo, selfie }
        assert.equal(closestStage(f), expected(f), JSON.stringify(f))
      }
  assert.equal(closestStage({ feePaid: false, cnic: 'approved', photo: 'approved', selfie: 'approved' }), 'ready')
  assert.equal(closestStage({ feePaid: false, cnic: 'approved', photo: 'approved', selfie: 'rejected' }), 'main_approved')
  assert.equal(closestStage({ feePaid: false, cnic: 'approved', photo: 'approved', selfie: 'waiting' }), 'main_approved', 'hotter chip wins')
  assert.equal(closestStage({ feePaid: false, cnic: 'waiting', photo: 'approved', selfie: 'waiting' }), 'all_uploaded')
  assert.equal(closestStage({ feePaid: false, cnic: 'waiting', photo: 'waiting', selfie: 'none' }), 'main_uploaded')
  assert.equal(closestStage({ feePaid: false, cnic: 'rejected', photo: 'approved', selfie: 'none' }), null)
  assert.equal(closestStage({ feePaid: false, cnic: 'none', photo: 'none', selfie: 'none' }), null)
  // Counts: each tutor once.
  const c = closestCounts(['ready', 'ready', 'main_uploaded', null])
  assert.deepEqual(c, { ready: 2, main_approved: 0, all_uploaded: 0, main_uploaded: 1 })
})

test('paid tutors never appear in any chip', () => {
  for (const cnic of STATES) for (const photo of STATES) for (const selfie of STATES) assert.equal(closestStage({ feePaid: true, cnic, photo, selfie }), null)
  // The loader also drops them before sorting.
  assert.match(read('lib/tutorFollowUps.ts'), /!r\.feePaid && !r\.notInterested && r\.closest !== null/)
})

test('the missing line is short and plain', () => {
  assert.equal(closestMissing({ feePaid: false, cnic: 'approved', photo: 'approved', selfie: 'approved' }), 'Pay fee')
  assert.equal(closestMissing({ feePaid: false, cnic: 'approved', photo: 'approved', selfie: 'none' }), 'Selfie missing · Pay fee')
  assert.equal(closestMissing({ feePaid: false, cnic: 'waiting', photo: 'approved', selfie: 'approved' }), 'CNIC waiting approval · Pay fee')
})

test('contacted in the last 3 days sinks; paused last; otherwise newest active first', () => {
  const rows = [
    { id: 'a', stage: 'ready' as const, paused: false, lastContactAt: ago(1), lastActiveAt: ago(0) },
    { id: 'b', stage: 'ready' as const, paused: false, lastContactAt: null, lastActiveAt: ago(5) },
    { id: 'c', stage: 'ready' as const, paused: false, lastContactAt: ago(4), lastActiveAt: ago(2) },
    { id: 'd', stage: 'ready' as const, paused: true, lastContactAt: null, lastActiveAt: ago(0) },
    { id: 'e', stage: 'main_uploaded' as const, paused: false, lastContactAt: null, lastActiveAt: ago(0) },
    { id: 'f', stage: 'main_approved' as const, paused: false, lastContactAt: null, lastActiveAt: ago(9) },
  ]
  assert.deepEqual(sortClosest(rows, NOW).map((r) => r.id), ['c', 'b', 'a', 'd', 'f', 'e'])
  assert.equal(contactedAgo(ago(2.2), NOW), 'Contacted 2 days ago')
  assert.equal(contactedAgo(ago(0.1), NOW), 'Contacted today')
  assert.equal(contactedAgo(null, NOW), null)
})

test('stage messages: plain English, a TutorMint link, no price, no superlative, no Urdu changed', () => {
  for (const stage of CLOSEST_STAGES) {
    for (const selfie of STATES) {
      const f: ClosestFacts = { feePaid: false, cnic: 'approved', photo: 'approved', selfie }
      const text = closestMessage(stage, f, 'Sana', '0321 5872222')
      assert.match(text, /https:\/\/www\.tutormint\.org\/(pay\/choose|tutor\/complete-profile)/)
      assert.ok(!/\bRs\b|PKR|rupee|199|best|largest|No\.?\s?1/i.test(text), text)
      assert.match(text, /^Assalam o Alaikum Sana,/)
    }
    assert.ok(isClosestTemplateKey(closestTemplateKey(stage)))
  }
  assert.ok(!isClosestTemplateKey('fu_fee_reply'))
  // The WhatsApp tap is recorded exactly like today's (the same route and recorder).
  assert.match(read('app/admin/follow-ups/ClosestRow.tsx'), /TutorFollowUpButtons/)
  assert.match(read('app/api/admin/follow-ups/tutor/route.ts'), /isClosestTemplateKey\(b\.templateKey\)/)
})

test('deleted accounts are in no work list or count, only under Deleted', () => {
  assert.equal(excludedReason({ role: 'tutor', erased: true }), 'deleted')
  assert.equal(excludedReason({ role: 'admin', erased: true }), 'deleted')
  assert.equal(excludedReason({ role: 'tutor' }), null)
  const people = [
    { id: '1', role: 'tutor', excluded: excludedReason({ role: 'tutor', erased: true }), deleted: true, kind: 'waiting' },
    { id: '2', role: 'tutor', excluded: null, deleted: false, kind: 'waiting' },
    { id: '3', role: 'tutor', excluded: 'test' as const, deleted: false, kind: 'waiting' },
  ]
  // Every default list (All, Paid, Unpaid, every Documents chip, the badge) is the "real" view.
  const real = people.filter((p) => inTabRule(p, peopleFixed('real')))
  assert.deepEqual(real.map((p) => p.id), ['2'])
  assert.equal(waitingBadge(real.map((p) => p.kind), []), 1)
  // "Show staff & test accounts" still never shows a deleted account.
  assert.deepEqual(people.filter((p) => inTabRule(p, peopleFixed('all'))).map((p) => p.id), ['2', '3'])
  // The grey Deleted chip shows exactly the deleted ones.
  assert.deepEqual(people.filter((p) => inTabRule(p, peopleFixed('deleted'))).map((p) => p.id), ['1'])
  // Follow-ups, parent follow-ups and the Overview read the same exclusion.
  assert.match(read('lib/staffOutreach.ts'), /p\.excluded !== null/)
  assert.match(read('lib/peopleDirectory.ts'), /account_erasures/)
})

test('suspended, banned and self-paused accounts stay listed and sort last', () => {
  const base = { suspended: false, banned: false, selfPaused: false }
  const out = sortPeople([
    { id: 'old', createdAt: '2026-10-01', ...base },
    { id: 'susp', createdAt: '2026-11-04', ...base, suspended: true },
    { id: 'new', createdAt: '2026-11-03', ...base },
    { id: 'self', createdAt: '2026-11-05', ...base, selfPaused: true },
    { id: 'ban', createdAt: '2026-10-20', ...base, banned: true },
  ])
  assert.deepEqual(out.map((p) => p.id), ['new', 'old', 'self', 'susp', 'ban'])
  // Follow-ups: a self-paused tutor is never overdue, gets the last rank and position.
  assert.match(read('lib/adminSummary.ts'), /rank: r\.paused \? 99/)
})

test('Backend Support sees the chips and the Ready to pay row, and no money', () => {
  const BS = 'backend_support' as const
  assert.ok((OVERVIEW_ITEM_KEYS as readonly string[]).includes('todo-ready-to-pay'))
  const keys = OVERVIEW_ITEM_KEYS as readonly string[]
  assert.equal(keys.indexOf('todo-ready-to-pay'), keys.indexOf('todo-docs') + 1, 'right after Documents to approve')
  assert.ok(roleSatisfies(BS, SCREEN_ACCESS[OVERVIEW_ITEMS['todo-ready-to-pay'].screen]))
  assert.ok(!isMoneyItem('todo-ready-to-pay'))
  assert.ok(!roleSatisfies(BS, SCREEN_ACCESS.paymentAmounts))
  // No amount on the closest card.
  assert.ok(!/amount|pkr\(/i.test(read('app/admin/follow-ups/ClosestRow.tsx')))
  const page = read('app/admin/page.tsx')
  const start = page.indexOf('= [', page.indexOf('const TODO_KEYS'))
  const todo = page.slice(start, page.indexOf(']', start))
  assert.ok(todo.indexOf("'todo-ready-to-pay'") > todo.indexOf("'todo-docs'"))
})
