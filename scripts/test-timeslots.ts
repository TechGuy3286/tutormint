/**
 * scripts/test-timeslots.ts   —   npm run test:timeslots
 *
 * The one time model (lib/timeSlots): the cut-offs, the free-text parsers used by
 * the backfill (tuition `timings` and tutor `availability_list`), and the short
 * display format. Pure — the DB backfill runs the same functions.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  slotForHour, formatSlots, slotsFromTimeText, daysFromText, parseTimings,
  parseAvailabilityList, slotsToAvailabilityList, normalizeSlots, type DaySlot,
} from '../lib/timeSlots'

test('cut-offs: <12 morning, 12–<16 afternoon, ≥16 evening (4pm = evening)', () => {
  assert.equal(slotForHour(9), 'morning')
  assert.equal(slotForHour(11), 'morning')
  assert.equal(slotForHour(12), 'afternoon')
  assert.equal(slotForHour(15), 'afternoon')
  assert.equal(slotForHour(16), 'evening') // 4:00 PM
  assert.equal(slotForHour(19), 'evening')
})

test('slotsFromTimeText — words, single clock, ranges, and unparseable', () => {
  assert.deepEqual(slotsFromTimeText('Evenings'), ['evening'])
  assert.deepEqual(slotsFromTimeText('Mornings'), ['morning'])
  assert.deepEqual(slotsFromTimeText('4:00 PM'), ['evening']) // owner example
  assert.deepEqual(slotsFromTimeText('6:00 PM'), ['evening'])
  assert.deepEqual(slotsFromTimeText('04:00 PM - 07:00 PM'), ['evening'])
  assert.deepEqual(slotsFromTimeText('10 AM to 10 PM'), ['morning', 'afternoon', 'evening'])
  assert.deepEqual(slotsFromTimeText('9 AM to 1 PM'), ['morning', 'afternoon'])
  // Ambiguous / bare numbers → unparseable (kept in old column, reported).
  assert.equal(slotsFromTimeText('4'), null)
  assert.equal(slotsFromTimeText('9 to 9'), null)
  assert.equal(slotsFromTimeText('3:00'), null)
  assert.equal(slotsFromTimeText(''), null)
})

test('daysFromText — groups and individual days', () => {
  assert.deepEqual(daysFromText('Weekdays'), ['mon', 'tue', 'wed', 'thu', 'fri'])
  assert.deepEqual(daysFromText('Weekends'), ['sat', 'sun'])
  assert.deepEqual(daysFromText('Every day'), ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
  assert.deepEqual(daysFromText('Mon/Wed/Fri evenings'), ['mon', 'wed', 'fri'])
  assert.deepEqual(daysFromText('Monday'), ['mon'])
})

test('parseTimings — the real tuition patterns', () => {
  assert.deepEqual(parseTimings('Weekdays, Evenings'),
    (['mon', 'tue', 'wed', 'thu', 'fri'] as const).map((d) => ({ day: d, slot: 'evening' as const })))
  assert.deepEqual(parseTimings('Weekends, Mornings'), [{ day: 'sat', slot: 'morning' }, { day: 'sun', slot: 'morning' }])
  assert.deepEqual(parseTimings('Mon/Wed/Fri evenings'),
    [{ day: 'mon', slot: 'evening' }, { day: 'wed', slot: 'evening' }, { day: 'fri', slot: 'evening' }])
  // "Evenings" with no day → every day (a time but no day still means something).
  assert.equal(parseTimings('Evenings')?.length, 7)
  // A day with no understandable time → null (do not invent the time).
  assert.equal(parseTimings('Weekdays'), null)
})

test('parseAvailabilityList — parseable convert, unparseable reported', () => {
  const r = parseAvailabilityList([
    { day: 'Monday', timeSlot: '4:00 PM' },
    { day: 'Tuesday', timeSlot: '6:00 PM' },
    { day: 'Wednesday', timeSlot: '4' }, // unparseable
  ])
  assert.deepEqual(r.slots, [{ day: 'mon', slot: 'evening' }, { day: 'tue', slot: 'evening' }])
  assert.equal(r.unparsed.length, 1)
  assert.equal(r.unparsed[0].timeSlot, '4')
})

test('formatSlots — the one short line, grouped by shared slot set', () => {
  const list: DaySlot[] = [
    { day: 'mon', slot: 'evening' }, { day: 'tue', slot: 'evening' }, { day: 'wed', slot: 'evening' },
    { day: 'sat', slot: 'morning' },
  ]
  assert.equal(formatSlots(list), 'Mon, Tue, Wed: Evening · Sat: Morning')
  assert.equal(formatSlots([{ day: 'mon', slot: 'morning' }, { day: 'mon', slot: 'evening' }]), 'Mon: Morning, Evening')
  assert.equal(formatSlots([]), '')
})

test('normalizeSlots dedupes + orders; round-trips through the old-column sync', () => {
  const messy: DaySlot[] = [{ day: 'wed', slot: 'evening' }, { day: 'mon', slot: 'evening' }, { day: 'mon', slot: 'evening' }]
  assert.deepEqual(normalizeSlots(messy), [{ day: 'mon', slot: 'evening' }, { day: 'wed', slot: 'evening' }])
  const legacy = slotsToAvailabilityList([{ day: 'mon', slot: 'evening' }])
  assert.equal(legacy.length, 1)
  assert.ok(legacy[0].includes('Monday') && legacy[0].includes('Evening'))
})
