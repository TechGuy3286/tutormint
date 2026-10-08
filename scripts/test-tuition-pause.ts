// npm run test:pause — the 7-day pause and the 150-a-night backlog (owner, 8 Oct 2026).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planPauseBatch, nextBatchAt, BACKLOG_BATCH } from '../lib/tuitionPauseCore'
import { PAUSE_AFTER_DAYS, pauseDueAtMs } from '../lib/tuitionStatus'

const DAY = 86_400_000
const now = Date.parse('2026-10-09T03:00:00Z')
const base = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString()

test('tuitions pause after 7 days', () => {
  assert.equal(PAUSE_AFTER_DAYS, 7)
  assert.equal(pauseDueAtMs(base(0)) - now, 7 * DAY)
})

test('a recently-due tuition pauses the same night; the backlog goes 150 at a time, oldest first', () => {
  const open = [
    { id: 'fresh', clockBase: base(7.2) }, // due 5h ago → ordinary
    { id: 'young', clockBase: base(3) }, // not due
    ...Array.from({ length: 378 }, (_, i) => ({ id: `old-${String(i).padStart(3, '0')}`, clockBase: base(9 + i * 0.05) })),
  ]
  const p = planPauseBatch(open, now)
  assert.deepEqual(p.regular.map((j) => j.id), ['fresh'])
  assert.equal(p.backlog.length, BACKLOG_BATCH)
  assert.equal(p.backlogLeft, 378 - 150)
  // oldest first
  assert.equal(p.backlog[0].id, 'old-377')
  assert.ok(!p.backlog.some((j) => j.id === 'young'))
})

test('the next batch is at 03:00 UTC', () => {
  assert.equal(nextBatchAt(new Date('2026-10-09T02:00:00Z')).toISOString(), '2026-10-09T03:00:00.000Z')
  assert.equal(nextBatchAt(new Date('2026-10-09T04:00:00Z')).toISOString(), '2026-10-10T03:00:00.000Z')
})
