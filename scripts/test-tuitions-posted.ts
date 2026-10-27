/**
 * scripts/test-tuitions-posted.ts — Team activity → Tuitions posted (owner,
 * 27 Oct 2026): columns, sort, the Former staff row and the Team total.
 * Invented data only.   npm run test:tuitionsposted
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  POSTED_COLUMNS,
  countPosts,
  emptyPostingCounts,
  formerRow,
  postingWindows,
  sortPostingRows,
  totalRow,
  type PostingRow,
} from '../lib/tuitionPostingCore'

const read = (p: string) => readFileSync(p, 'utf8')
const row = (id: string, name: string, c: Partial<ReturnType<typeof emptyPostingCounts>>, repeats = 0): PostingRow => ({
  id,
  name,
  counts: { ...emptyPostingCounts(), ...c },
  repeats,
})

test('the columns are the owner’s six plus Consent recorded (27 Oct 2026), in order', () => {
  assert.deepEqual([...POSTED_COLUMNS], ['Staff', 'Today', 'Yesterday', 'Last 7 days', 'All time', 'Consent recorded', 'Repeated this week'])
  const page = read('app/admin/team-activity/page.tsx')
  assert.ok(page.includes('POSTED_COLUMNS.map'))
  assert.ok(!page.includes('Today vs Yesterday'))
  assert.ok(!page.includes('vs previous 7'))
})

test('counts: today, yesterday, last 7 days and all time (Pakistan time)', () => {
  const now = Date.parse('2026-10-27T06:00:00Z') // 11:00 PKT
  const w = postingWindows(now)
  const c = countPosts(
    [
      Date.parse('2026-10-26T20:00:00Z'), // today 01:00 PKT
      Date.parse('2026-10-26T08:00:00Z'), // yesterday
      Date.parse('2026-10-23T08:00:00Z'), // last 7 days
      Date.parse('2026-09-01T08:00:00Z'), // long ago — all time only
      Date.parse('2026-10-28T08:00:00Z'), // in the future — ignored
    ],
    w,
  )
  assert.deepEqual(c, { today: 1, yesterday: 1, last7: 3, allTime: 4 })
})

test('sorted by Last 7 days, highest first (then Today, then name)', () => {
  const rows = sortPostingRows([
    row('a', 'Amna', { today: 5, last7: 6 }),
    row('b', 'Bilal', { today: 0, last7: 9 }),
    row('c', 'Chand', { today: 1, last7: 6 }),
  ])
  assert.deepEqual(rows.map((r) => r.id), ['b', 'a', 'c'])
})

test('former staff are one row, and count in the Team total', () => {
  const current = [row('a', 'Amna', { today: 1, yesterday: 2, last7: 3, allTime: 10 }, 1)]
  const former = [row('x', 'Xenia', { last7: 1, allTime: 40 }), row('y', 'Yusuf', { allTime: 5 }, 2)]
  const f = formerRow(former)
  assert.equal(f.name, 'Former staff')
  assert.deepEqual(f.counts, { today: 0, yesterday: 0, last7: 1, allTime: 45 })
  assert.equal(f.repeats, 2)
  const t = totalRow(current, former)
  assert.equal(t.name, 'Team total')
  assert.deepEqual(t.counts, { today: 1, yesterday: 2, last7: 4, allTime: 55 })
  assert.equal(t.repeats, 3)
})

test('the loader reads all-time posts, former staff, and never shows an email as a name', () => {
  const src = read('lib/tuitionPosting.ts')
  assert.ok(src.includes("not('former_staff_at', 'is', null)"))
  assert.ok(!src.includes(".gte('created_at'"), 'all time needs every post')
  assert.ok(src.includes('total: totalRow(sorted, formerSorted)'))
  assert.ok(!/formatName\(rawName\) \|\| email/.test(src))
  const page = read('app/admin/team-activity/page.tsx')
  assert.ok(page.includes('<FormerStaffRows'))
})
