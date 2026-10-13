// npm run test:pause — the 15-day pause and the 150-a-night backlog (owner, 13 Oct 2026).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planPauseBatch, nextBatchAt, BACKLOG_BATCH } from '../lib/tuitionPauseCore'
import { TUITION_LIVE_DAYS, pauseDueAtMs } from '../lib/tuitionStatus'

const DAY = 86_400_000
const now = Date.parse('2027-03-09T03:00:00Z')
const base = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString()

test('tuitions pause after 15 days', () => {
  assert.equal(TUITION_LIVE_DAYS, 15)
  assert.equal(pauseDueAtMs(base(0)) - now, 15 * DAY)
})

test('a tuition due after the cutoff pauses the same night; everything due before it is backlog, 150 at a time, oldest first', () => {
  const cutoff = now - 0.5 * DAY
  const open = [
    { id: 'fresh', clockBase: base(15.2) }, // due 5h ago, after the cutoff → ordinary
    { id: 'just-before', clockBase: base(15.6) }, // due 14h ago, before the cutoff → backlog
    { id: 'young', clockBase: base(3) }, // not due
    ...Array.from({ length: 378 }, (_, i) => ({ id: `old-${String(i).padStart(3, '0')}`, clockBase: base(17 + i * 0.05) })),
  ]
  const p = planPauseBatch(open, now, BACKLOG_BATCH, cutoff)
  assert.deepEqual(p.regular.map((j) => j.id), ['fresh'])
  assert.equal(p.backlog.length, BACKLOG_BATCH)
  assert.equal(p.backlogLeft, 379 - 150)
  // oldest first
  assert.equal(p.backlog[0].id, 'old-377')
  assert.ok(!p.backlog.some((j) => j.id === 'young'))
})

test('the next batch is at 03:00 UTC', () => {
  assert.equal(nextBatchAt(new Date('2026-10-09T02:00:00Z')).toISOString(), '2026-10-09T03:00:00.000Z')
  assert.equal(nextBatchAt(new Date('2026-10-09T04:00:00Z')).toISOString(), '2026-10-10T03:00:00.000Z')
})

test('the backlog of the 13 Oct change: tuitions due at the floor go 150 a night, oldest first', () => {
  const floorNight = Date.parse('2026-10-17T03:00:00Z')
  const open = Array.from({ length: 200 }, (_, i) => ({ id: `t-${String(i).padStart(3, '0')}`, clockBase: new Date(Date.parse('2026-09-01T00:00:00Z') + i * 3_600_000).toISOString() }))
  const p = planPauseBatch(open, floorNight)
  assert.equal(p.regular.length, 0)
  assert.equal(p.backlog.length, BACKLOG_BATCH)
  assert.equal(p.backlog[0].id, 't-000')
  assert.equal(p.backlogLeft, 50)
  // Nothing is paused before the floor.
  assert.equal(planPauseBatch(open, Date.parse('2026-10-14T03:00:00Z')).backlog.length, 0)
})
