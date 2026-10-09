// Infinite lists never show an id twice (owner, 10 Oct 2026 — "Sehar Arif"
// appeared twice on /browse/tutors).
//
// 1. Keyset paging through a list whose sort values are heavily TIED never sees
//    an id twice and never skips one, as long as the key ends on a unique
//    tie-breaker (the member id, or rank_tutors' md5(id || date)).
// 2. The client merge (lib/infiniteMerge) drops ids already shown, and refuses a
//    saved snapshot that overlaps the fresh server window — the actual cause.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { mergeUnique, snapshotUsable, uniqueById } from '../lib/infiniteMerge'

type Row = { id: string; tier: number; completion: number; score: number }

// 60 rows, only 3 tiers × 2 completion values — almost every row ties with
// many others on the sort values.
const ROWS: Row[] = Array.from({ length: 60 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  tier: i % 3,
  completion: i % 2 ? 100 : 80,
  score: 4.5,
}))

// The rank_tutors shape: tier desc, completion desc, score desc, then the id.
function cmp(a: Row, b: Row): number {
  if (a.tier !== b.tier) return b.tier - a.tier
  if (a.completion !== b.completion) return b.completion - a.completion
  if (a.score !== b.score) return b.score - a.score
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function page(after: Row | null, limit: number, withIdTiebreak = true): Row[] {
  const sorted = [...ROWS].sort(withIdTiebreak ? cmp : (a, b) => cmp({ ...a, id: '' }, { ...b, id: '' }))
  const rest = after ? sorted.filter((r) => (withIdTiebreak ? cmp(r, after) > 0 : cmp({ ...r, id: '' }, { ...after, id: '' }) > 0)) : sorted
  return rest.slice(0, limit)
}

test('keyset paging over tied sort values never repeats or skips an id', () => {
  for (const size of [1, 5, 7, 12, 59, 60]) {
    const seen: string[] = []
    let last: Row | null = null
    for (let guard = 0; guard < 200; guard++) {
      const rows = page(last, size)
      if (rows.length === 0) break
      seen.push(...rows.map((r) => r.id))
      last = rows[rows.length - 1]
    }
    assert.equal(new Set(seen).size, seen.length, `page size ${size}: an id repeated`)
    assert.equal(seen.length, ROWS.length, `page size ${size}: an id was skipped`)
  }
})

test('without the unique tie-breaker the same tied list loses rows (why the id must be last)', () => {
  const seen: string[] = []
  let last: Row | null = null
  for (let guard = 0; guard < 200; guard++) {
    const rows = page(last, 12, false)
    if (rows.length === 0) break
    seen.push(...rows.map((r) => r.id))
    last = rows[rows.length - 1]
  }
  assert.ok(seen.length < ROWS.length)
})

test('mergeUnique drops ids already shown (server window, earlier pages, within a page)', () => {
  const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' }, d = { id: 'd' }
  assert.deepEqual(mergeUnique([a, b], [b, c, c, d], ['d']), [a, b, c])
  // Rows without an id are never dropped.
  const n1 = { x: 1 }, n2 = { x: 2 }
  assert.deepEqual(mergeUnique([n1], [n2]), [n1, n2])
  assert.deepEqual(uniqueById([a, a, b]), [a, b])
})

test('the Sehar case: a saved snapshot that overlaps the fresh server window is not restored', () => {
  const sehar = 'f696795a-2298-45a8-a164-e9f15111dd62'
  const serverWindow = ['t1', 't2', sehar] // she moved up into the first window
  const savedRows = [{ id: 't20' }, { id: sehar, headline: null }, { id: 't22' }] // older copy
  assert.equal(snapshotUsable(savedRows, serverWindow), false)
  // A snapshot with no overlap is still restored.
  assert.equal(snapshotUsable([{ id: 't20' }, { id: 't22' }], serverWindow), true)
  assert.equal(snapshotUsable(savedRows, []), true)
})

test('useInfinite applies the merge on append and on restore; the public lists pass their server ids', () => {
  const s = readFileSync(new URL('../lib/useInfinite.ts', import.meta.url), 'utf8')
  assert.match(s, /setItems\(\(prev\) => mergeUnique\(prev, page\.items, serverIdsRef\.current\)\)/)
  assert.match(s, /if \(!snapshotUsable\(s\.items, serverIdsRef\.current\)\)/)
  for (const f of [
    'app/(site)/browse/tutors/page.tsx',
    'app/(site)/browse/tuitions/page.tsx',
    'components/landing/LandingView.tsx',
    'components/tuitionJobs/CityJobsView.tsx',
  ]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
    assert.match(src, /uniqueById\(/, `${f} renders one card per id`)
    assert.match(src, /serverIds=\{/, `${f} hands its ids to the load-more list`)
  }
  // Both SQL/TS orders end on a unique key.
  const rank = readFileSync(new URL('../supabase/migrations/137_rejected_tutors_hidden_verified_first.sql', import.meta.url), 'utf8')
  assert.match(rank, /md5\(d\.id::text \|\| p_today::text\) as sort_hash/)
  assert.match(rank, /round\(e\.score, 2\) desc,\s*e\.sort_hash/)
  const jobs = readFileSync(new URL('../lib/jobFeed.ts', import.meta.url), 'utf8')
  assert.match(jobs, /\.order\('bumped_at', \{ ascending: false \}\)\s*\.order\('id', \{ ascending: false \}\)/)
})
