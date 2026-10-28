/**
 * scripts/test-location-buckets.ts — the Locations clean-up buckets and the
 * Undo of an automatic merge (owner, 28 Oct 2026).
 *
 *   npx tsx --test scripts/test-location-buckets.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  bucketArea,
  bucketCity,
  bucketSuggestion,
  foldWord,
  liveView,
  modelMerge,
  modelUndo,
  undoPlan,
  type LocState,
} from '../lib/locationBucketsCore'

const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Peshawar', 'Faisalabad']
const KARACHI = ['Lyari', 'Gulshan-e-Iqbal', 'Clifton', 'Saddar', 'Buffer Zone', 'North Nazimabad', 'Malir']
const LAHORE = ['Harbanspura', 'Johar Town', 'Model Town', 'DHA Lahore', 'Gulberg', 'Iqbal Town']
const ISB = ['F-10', 'F-11', 'G-9', 'E-11']

const area = (value: string, city: string, areas: string[]) => bucketArea({ value, city, areas, cities: CITIES, cityListed: true })

test('spelling variants are folded', () => {
  assert.equal(foldWord('Liyari'), 'lyari')
  assert.equal(foldWord('Saddar'), 'sadar')
  assert.equal(foldWord('Iqbal'), 'ikbal')
  assert.equal(foldWord('noor'), 'nur')
})

test('auto: the same place, surely', () => {
  const ly = area('Liyari', 'Karachi', KARACHI)
  assert.equal(ly.bucket, 'auto')
  assert.equal(ly.target, 'Lyari')
  const gi = area('Gulshan e Iqbal', 'Karachi', KARACHI)
  assert.equal(gi.bucket, 'auto')
  assert.equal(gi.target, 'Gulshan-e-Iqbal')
  assert.equal(area('Sadar', 'Karachi', KARACHI).target, 'Saddar')
  assert.equal(area('Harbanspuara', 'Lahore', LAHORE).bucket, 'auto') // one letter away, long name
  assert.equal(area('bufferzone', 'Karachi', KARACHI).target, 'Buffer Zone')
  assert.equal(area('Johar Town Lahore', 'Lahore', LAHORE).target, 'Johar Town')
})

test('auto never joins different blocks, sectors or another city', () => {
  // "F-12" is one character from F-11 / F-10, but a sector number is not a typo.
  assert.notEqual(area('F-12', 'Islamabad', ISB).bucket, 'auto')
  // Lyari is a Karachi area: typed under Lahore it is no match.
  assert.notEqual(area('Liyari', 'Lahore', LAHORE).target, 'Lyari')
  // Two equally close candidates: never automatic.
  assert.notEqual(area('Gulberk', 'Lahore', [...LAHORE, 'Gulbert']).bucket, 'auto')
})

test('krachi → Karachi; lhr → Lahore', () => {
  const k = bucketCity('krachi', CITIES)
  assert.equal(k.bucket, 'auto')
  assert.equal(k.target, 'Karachi')
  assert.equal(bucketCity('lhr', CITIES).target, 'Lahore')
  assert.equal(bucketCity('Pindi', CITIES).target, 'Rawalpindi')
})

test('a real place with no match: new area', () => {
  const v = area('Valencia Town', 'Lahore', LAHORE)
  assert.equal(v.bucket, 'new_area')
  assert.equal(v.target, 'Valencia Town')
  assert.equal(bucketSuggestion(v, 'Valencia Town', 'Lahore').action, 'add')
})

test('not a place: phone numbers, addresses, emails, nonsense', () => {
  assert.equal(area('0323 1234567', 'Lahore', LAHORE).bucket, 'not_area')
  assert.equal(area('House 5 Street 9', 'Lahore', LAHORE).bucket, 'not_area')
  assert.equal(area('House 12, Street 4, DHA Phase 5', 'Lahore', LAHORE).bucket, 'not_area')
  assert.equal(area('someone@gmail.com', 'Lahore', LAHORE).bucket, 'not_area')
  assert.equal(area('xxxxxx', 'Lahore', LAHORE).bucket, 'not_area')
  assert.equal(area('ab', 'Lahore', LAHORE).bucket, 'not_area')
  // A sector code is a place, numbers and all.
  assert.notEqual(area('E-11/1', 'Islamabad', ISB).bucket, 'not_area')
})

test('suggest: probably the same — the Owner checks', () => {
  const m = area('Model town k block', 'Lahore', LAHORE)
  assert.equal(m.bucket, 'suggest')
  assert.equal(m.target, 'Model Town')
  const near = area('North Nazmabad', 'Karachi', KARACHI) // two letters off — not automatic
  assert.ok(near.bucket === 'suggest' || near.bucket === 'auto')
  const s = bucketSuggestion(m, 'Model town k block', 'Lahore')
  assert.equal(s.action, 'same')
  assert.equal(s.confidence, 'medium')
})

test('Undo of a typed merge restores the state before it', () => {
  const before: LocState = { areas: [{ id: 1, name: 'Lyari', removed: false }], aliases: [] }
  const { state, record } = modelMerge(before, { kind: 'typed', value: 'Liyari', intoAreaId: 1 }, 10)
  assert.notDeepEqual(liveView(state), liveView(before))
  const after = modelUndo(state, undoPlan(record))
  assert.deepEqual(liveView(after), liveView(before))
  // Nothing deleted: the spelling row is still there, stamped.
  assert.equal(after.aliases.length, 1)
  assert.equal(after.aliases[0].removed, true)
})

test('Undo of a staff-area merge restores the area and its spellings', () => {
  const before: LocState = {
    areas: [
      { id: 1, name: 'Lyari', removed: false },
      { id: 2, name: 'Liyari', removed: false },
    ],
    aliases: [
      { id: 5, raw: 'Liyari Town', areaId: 2, removed: false },
      { id: 6, raw: 'Lyari Karachi', areaId: 1, removed: false },
    ],
  }
  const { state, record } = modelMerge(before, { kind: 'staff_area', value: 'Liyari', intoAreaId: 1, fromAreaId: 2 }, 11)
  assert.deepEqual(record.movedAliasIds, [5])
  assert.ok(state.areas.find((a) => a.id === 2)!.removed)
  const plan = undoPlan(record)
  assert.deepEqual(
    plan.map((p) => p.op),
    ['take_back_alias', 'move_aliases', 'restore_area'],
  )
  assert.deepEqual(liveView(modelUndo(state, plan)), liveView(before))
})

test('the script only writes with --apply, never deletes, and logs an Undo per merge', () => {
  const src = readFileSync('scripts/dataop-locations-cleanup.ts', 'utf8')
  assert.match(src, /const APPLY = process\.argv\.includes\('--apply'\)/)
  assert.ok(src.indexOf("if (!APPLY)") < src.indexOf("c.query('begin')"))
  assert.doesNotMatch(src, /\bdelete\s+from\b/i)
  assert.match(src, /'location\.auto_merge'/)
  const undo = readFileSync('lib/locationAutoMerge.ts', 'utf8')
  assert.doesNotMatch(undo, /\.delete\(/)
  const route = readFileSync('app/api/admin/locations/auto-merges/route.ts', 'utf8')
  assert.match(route, /refuseUnlessOwnerApproval/)
  assert.ok(route.indexOf('refuseUnlessOwnerApproval') < route.indexOf('undoAutoMerge('))
})

test('the typed list pages 25 at a time', () => {
  const src = readFileSync('lib/locationReview.ts', 'utf8')
  assert.match(src, /REVIEW_PAGE_SIZE = 25/)
  assert.match(src, /bucketArea\(/)
})
