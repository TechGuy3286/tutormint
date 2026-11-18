/**
 * scripts/test-browse-restore.ts — PR-08 (owner, 18 Nov 2026): Browse
 * remembers where you were, and shortlisted hearts are filled client-side.
 * INVENTED data only.
 *   - Back restores the scroll offset (also inside the first window) and every
 *     "Load more" page; a fresh visit starts at the top; a stale snapshot's
 *     rows are dropped;
 *   - the offset saved is the reader's last scroll, never the 0 of the next page;
 *   - hearts: no shortlist in the cached HTML; one request fills every card;
 *     a toggle updates every card.
 *
 *   npm run test:browserestore
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { cameBack, restorePlan, scrollRestoreDone, SNAPSHOT_MAX_AGE_MS, type Snapshot } from '../lib/infiniteRestoreCore'
import { createShortlistStore, SHORTLIST_ENDPOINT, STALE_MS } from '../lib/shortlistStoreCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const NOW = Date.UTC(2026, 10, 18, 5, 0, 0)

type Row = { id: string }
const snap = (p: Partial<Snapshot<Row>> = {}): Snapshot<Row> => ({
  items: [{ id: 'r21' }, { id: 'r22' }, { id: 'r23' }],
  cursor: 'c3',
  scrollY: 4200,
  savedAt: NOW - 60_000,
  ...p,
})

test('Back restores every Load more page, its cursor and the offset', () => {
  const plan = restorePlan(snap(), ['r1', 'r2'], { mode: 'back', back: true, nowMs: NOW })
  assert.deepEqual(plan, { items: [{ id: 'r21' }, { id: 'r22' }, { id: 'r23' }], cursor: 'c3', scrollY: 4200 })
})

test('Back with no Load more page still restores the offset in the first window', () => {
  const plan = restorePlan(snap({ items: [], cursor: null, scrollY: 900 }), ['r1'], { mode: 'back', back: true, nowMs: NOW })
  assert.deepEqual(plan, { items: [], cursor: undefined, scrollY: 900 })
})

test('a fresh visit (not Back) starts at the top with the server window', () => {
  assert.equal(restorePlan(snap(), [], { mode: 'back', back: false, nowMs: NOW }), null)
})

test('a very old snapshot is not restored', () => {
  assert.equal(restorePlan(snap({ savedAt: NOW - SNAPSHOT_MAX_AGE_MS - 1 }), [], { mode: 'back', back: true, nowMs: NOW }), null)
})

test('the ranking moved: stale rows and cursor dropped, offset kept on Back', () => {
  const plan = restorePlan(snap(), ['r1', 'r22'], { mode: 'back', back: true, nowMs: NOW })
  assert.deepEqual(plan, { items: [], cursor: undefined, scrollY: 4200 })
})

test("admin lists keep the old 'always' behaviour", () => {
  assert.deepEqual(restorePlan(snap(), [], { mode: 'always', back: false, nowMs: NOW })?.cursor, 'c3')
  assert.equal(restorePlan(snap({ items: [] }), [], { mode: 'always', back: false, nowMs: NOW }), null)
  assert.equal(restorePlan(snap(), ['r21'], { mode: 'always', back: false, nowMs: NOW }), null)
})

test('Back is a popstate in this tab or a back/forward document load', () => {
  assert.equal(cameBack({ popRecent: true, docBackForward: false }), true)
  assert.equal(cameBack({ popRecent: false, docBackForward: true }), true)
  assert.equal(cameBack({ popRecent: false, docBackForward: false }), false)
})

test('the restore keeps trying while the page grows, and yields to the reader', () => {
  assert.equal(scrollRestoreDone({ target: 4200, current: 1800, elapsedMs: 100, userMoved: false }), false)
  assert.equal(scrollRestoreDone({ target: 4200, current: 4199, elapsedMs: 100, userMoved: false }), true)
  assert.equal(scrollRestoreDone({ target: 4200, current: 1800, elapsedMs: 100, userMoved: true }), true)
  assert.equal(scrollRestoreDone({ target: 4200, current: 1800, elapsedMs: 3000, userMoved: false }), true)
})

test('both Browse lists use Back restore; the saved offset is the reader’s last scroll', () => {
  assert.match(read('app/(site)/browse/tutors/MoreTutors.tsx'), /restoreMode: 'back'/)
  assert.match(read('app/(site)/browse/tuitions/MoreJobs.tsx'), /restoreMode: 'back'/)
  const hook = read('lib/useInfinite.ts')
  assert.match(hook, /addEventListener\('popstate'/)
  assert.match(hook, /lastOffset\.current \?\?/)
  assert.match(hook, /addEventListener\('scroll', onScroll/)
  assert.match(hook, /sessionStorage\.setItem/)
  // Pages stay static: the state is client-side only.
  for (const p of ['app/(site)/browse/tutors/page.tsx', 'app/(site)/browse/tuitions/page.tsx']) assert.match(read(p), /export const revalidate = \d+/)
})

// --------------------------------------------------------------- hearts ---

test('no shortlist in the server-rendered Browse page', () => {
  const view = read('app/(site)/browse/tutors/BrowseTutorsView.tsx')
  assert.ok(!/from\('shortlists'\)/.test(view), 'BrowseTutorsView must not read shortlists')
  assert.ok(!/initiallySaved=\{/.test(view), 'no heart state passed from the server')
  const card = read('components/TutorCard.tsx')
  assert.match(card, /useShortlisted\(tutor\.id,/)
  assert.match(card, /markShortlisted\(tutor\.id,/)
  const route = read('app/api/viewer/shortlist/route.ts')
  assert.match(route, /private, no-store/)
  assert.match(route, /force-dynamic/)
})

test('one request fills every card; toggles update all; stale copies are asked again', async () => {
  let calls = 0
  const store = createShortlistStore(async (url) => {
    calls++
    assert.equal(url, SHORTLIST_ENDPOINT)
    return { ok: true, json: async () => ({ ids: ['t1', 't3'] }) }
  })
  assert.equal(store.get(), null, 'nothing before load (cards show the empty heart)')
  let heard = 0
  const off = store.subscribe(() => heard++)
  const [a, b] = await Promise.all([store.load(NOW), store.load(NOW)])
  assert.equal(calls, 1, 'one request for the whole page')
  assert.ok(a.has('t1') && b.has('t3') && !a.has('t2'))
  store.set('t2', true)
  assert.ok(store.get()!.has('t2'))
  store.set('t1', false)
  assert.ok(!store.get()!.has('t1'))
  assert.ok(heard >= 3)
  off()
  await store.load(Date.now())
  assert.equal(calls, 1, 'fresh copy reused')
  await store.load(Date.now() + STALE_MS + 1)
  assert.equal(calls, 2, 'stale copy asked again')
})

test('a failed or signed-out answer leaves every heart empty', async () => {
  const bad = createShortlistStore(async () => ({ ok: false, json: async () => ({}) }))
  assert.equal((await bad.load(NOW)).size, 0)
  const thrown = createShortlistStore(async () => {
    throw new Error('offline')
  })
  assert.equal((await thrown.load(NOW)).size, 0)
})
