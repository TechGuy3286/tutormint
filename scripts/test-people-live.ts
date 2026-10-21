/**
 * scripts/test-people-live.ts  —  npm run test:people:live
 *
 * Read-only, against the real database: the People tabs' counts equal the
 * Overview "New tutors" / "New parents" totals and the "Documents to approve"
 * row, and the People badge equals the tabs' Waiting chips. Skips without a
 * service-role key.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const live = !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_URL

test('People counts match the Overview', { skip: !live && 'no service-role key' }, async () => {
  const { directoryCounts, inTab, loadDirectory, loadDirectoryDocs, peopleWaitingCount } = await import('../lib/peopleDirectory')
  const { loadOverviewList } = await import('../lib/overviewItems')
  const counts = await directoryCounts()
  const tutors = await loadOverviewList('tutors')
  const parents = await loadOverviewList('parents')
  const docs = await loadOverviewList('todo-docs')
  assert.equal(tutors.rows.length, counts.tutors, 'New tutors Total = Tutors tab')
  assert.equal(parents.rows.length, counts.parents, 'New parents Total = Parents tab')
  const badge = await peopleWaitingCount()
  assert.equal(docs.rows.length, badge, 'Documents to approve = People badge')
  const d = await loadDirectory()
  const dd = await loadDirectoryDocs()
  const chips =
    inTab(d.people, 'tutor', false).filter((p) => dd.get(p.id)?.kind === 'waiting').length +
    inTab(d.people, 'parent', false).filter((p) => p.parent?.verification === 'waiting').length
  assert.equal(badge, chips, 'badge = Waiting chips')
  // The toggle only ever adds people.
  assert.ok(inTab(d.people, 'tutor', true).length >= counts.tutors)
  assert.ok(inTab(d.people, 'parent', true).length >= counts.parents)
})
