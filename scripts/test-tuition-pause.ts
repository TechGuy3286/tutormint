// npm run test:pause — the 20-day pause (owner, 21 Oct 2026; 15 from 13 Oct), the
// 150-a-night backlog, and the one-time resume of tuitions the old 15-day rule paused.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planPauseBatch, nextBatchAt, BACKLOG_BATCH } from '../lib/tuitionPauseCore'
import { TUITION_LIVE_DAYS, pauseDueAtMs, isPauseDue } from '../lib/tuitionStatus'
import { resumeVerdict, type ResumeCandidate } from '../lib/autoPauseResumeCore'

const DAY = 86_400_000
const now = Date.parse('2027-03-09T03:00:00Z')
const base = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString()

test('tuitions pause at day 20, not day 15', () => {
  assert.equal(TUITION_LIVE_DAYS, 20)
  assert.equal(pauseDueAtMs(base(0)) - now, 20 * DAY)
  assert.equal(isPauseDue(base(15), now), false, 'day 15 is no longer a pause')
  assert.equal(isPauseDue(base(19.9), now), false)
  assert.equal(isPauseDue(base(20), now), true, 'day 20 is')
  assert.deepEqual(planPauseBatch([{ id: 'd15', clockBase: base(15.5) }, { id: 'd21', clockBase: base(21) }], now, BACKLOG_BATCH, now - 10 * DAY).regular.map((j) => j.id), ['d21'])
})

const cand = (over: Partial<ResumeCandidate> = {}): ResumeCandidate => ({
  id: 'j', status: 'paused', pauseSource: 'auto', selfPausedAt: null, mergedInto: null,
  createdAt: base(17), resumedAt: null, posterSuspended: false, posterBanned: false, posterPausedByUser: false,
  isTeam: false, contactPhone: null, contactWhatsapp: null, parentPhone: '03001234567', parentPhoneVerifiedAt: base(30),
  ...over,
})

test('the one-time resume touches only age-based auto-pauses under 20 days old', () => {
  assert.equal(resumeVerdict(cand(), now), 'resume')
  assert.equal(resumeVerdict(cand({ pauseSource: 'backlog' }), now), 'resume')
  assert.equal(resumeVerdict(cand({ resumedAt: base(16), createdAt: base(40) }), now), 'resume', 'the clock is the last resume')
  // Too old under the new rule — stays paused.
  assert.equal(resumeVerdict(cand({ createdAt: base(20.5) }), now), 'too_old')
  // Every other kind of pause is left alone.
  for (const src of ['admin', 'poster', 'self', 'no_contact', null]) assert.equal(resumeVerdict(cand({ pauseSource: src }), now), 'not_age_pause', String(src))
  assert.equal(resumeVerdict(cand({ selfPausedAt: base(2) }), now), 'not_age_pause')
  assert.equal(resumeVerdict(cand({ mergedInto: 'other' }), now), 'not_age_pause')
  for (const st of ['open', 'closed', 'hired']) assert.equal(resumeVerdict(cand({ status: st }), now), 'not_age_pause', st)
  // A poster who is suspended, banned or paused their own account — stays paused.
  assert.equal(resumeVerdict(cand({ posterSuspended: true }), now), 'poster_unavailable')
  assert.equal(resumeVerdict(cand({ posterBanned: true }), now), 'poster_unavailable')
  assert.equal(resumeVerdict(cand({ posterPausedByUser: true }), now), 'poster_unavailable')
  // No contact number — cannot go live.
  assert.equal(resumeVerdict(cand({ parentPhoneVerifiedAt: null }), now), 'no_contact')
  assert.equal(resumeVerdict(cand({ isTeam: true, contactPhone: null }), now), 'no_contact')
  assert.equal(resumeVerdict(cand({ isTeam: true, contactPhone: '0321 1234567' }), now), 'resume')
})

test('a tuition due after the cutoff pauses the same night; everything due before it is backlog, 150 at a time, oldest first', () => {
  const cutoff = now - 0.5 * DAY
  const open = [
    { id: 'fresh', clockBase: base(20.2) }, // due 5h ago, after the cutoff → ordinary
    { id: 'just-before', clockBase: base(20.6) }, // due 14h ago, before the cutoff → backlog
    { id: 'young', clockBase: base(3) }, // not due
    ...Array.from({ length: 378 }, (_, i) => ({ id: `old-${String(i).padStart(3, '0')}`, clockBase: base(22 + i * 0.05) })),
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
