/**
 * scripts/test-push2-live.ts — npm run test:push2:live
 *
 * Push 2 (owner, 1 Nov 2026): the stored People and Follow-ups lists, paged and
 * counted in SQL (admin_list_page, migration 219), must give exactly what the
 * old in-memory rules gave. Two halves:
 *   1. read every stored row back, apply the OLD page rules to them in memory
 *      (rowsForChip, the To do / Followed up order, parentChipMatch, the search)
 *      and require the SQL answer to be identical — counts, ids and their order;
 *   2. the stored lists hold the same people as a fresh load right now (a few
 *      members may have acted in between, so up to 3 differences per list).
 *
 * READ ONLY: it never writes. Run after the summary has been built (the cron,
 * or scripts/run-admin-summary.ts). Skips without a database.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createAdminClient } from '../lib/supabase/admin'
import { listPage, type ListQuery } from '../lib/adminSummary'
import { PARENT_FU_LIST, peopleList, tutorFuList } from '../lib/adminSummaryCore'
import { chipRank, FOLLOW_CHIPS, type ChipFilter, type FollowChip } from '../lib/tutorFollowUpCore'
import { TUTOR_SCOPES } from '../lib/staffOutreachCore'
import { parentChipMatch, type ParentChip } from '../lib/parentFollowUpCore'
import { loadTutorFollowUps, type TutorFollowRow } from '../lib/tutorFollowUps'
import { loadParentFollowUps, type ParentFollowRow } from '../lib/parentFollowUps'
import { loadDirectory } from '../lib/peopleDirectory'

const admin = createAdminClient()
const skip = admin ? false : 'no database'
const BIG = 500 // admin_list_page never returns more than 500 rows at once

/** Every row of a query, 500 at a time through offset — the same paging Load more uses. */
async function every<R>(list: string, q: ListQuery) {
  const first = await listPage<R>(list, { ...q, offset: 0, limit: BIG })
  const rows = [...first.rows]
  for (let off = BIG; off < first.total; off += BIG) rows.push(...(await listPage<R>(list, { ...q, offset: off, limit: BIG })).rows)
  assert.equal(rows.length, first.total, `${list}: paging returned every row`)
  return { ...first, rows }
}

type Stored<R> = { member_id: string; pos: number; search: string; row: R }

async function stored<R>(list: string): Promise<Stored<R>[]> {
  const out: Stored<R>[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin!
      .from('admin_list_rows')
      .select('member_id, pos, search, row')
      .eq('list', list)
      .order('pos')
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as Stored<R>[]))
    if (!data || data.length < 1000) return out
  }
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id)
const sqlIds = <R>(p: { rows: { id: string; row: R }[] }) => p.rows.map((r) => r.id)

function oldTutorChip(rows: TutorFollowRow[], chip: ChipFilter): TutorFollowRow[] {
  if (chip !== 'all') return rows.filter((r) => (r.chips as FollowChip[]).includes(chip))
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => chipRank(a.r.primary) - chipRank(b.r.primary) || a.i - b.i)
    .map((x) => x.r)
}

function sameSet(a: string[], b: string[], what: string, slack = 3) {
  const A = new Set(a)
  const B = new Set(b)
  const diff = [...a.filter((x) => !B.has(x)), ...b.filter((x) => !A.has(x))]
  assert.ok(diff.length <= slack, `${what}: ${diff.length} differ (stored vs fresh)`)
}

test('Follow-ups → Tutors: SQL counts, tabs and order equal the old rules on the same rows', { skip }, async () => {
  for (const scope of TUTOR_SCOPES) {
    const list = tutorFuList(scope)
    const rows = (await stored<TutorFollowRow>(list)).map((s) => s.row)
    for (const chip of ['all', ...FOLLOW_CHIPS] as ChipFilter[]) {
      const chipRows = oldTutorChip(rows, chip)
      for (const tab of ['todo', 'sent'] as const) {
        const inTab = chipRows.filter((r) => r.state.tab === tab)
        const want =
          tab === 'todo'
            ? [...inTab.filter((r) => r.state.overdue), ...inTab.filter((r) => !r.state.overdue)]
            : inTab.filter((r) => r.state.section === 'sent').sort((a, b) => Date.parse(a.state.dueAt ?? '') - Date.parse(b.state.dueAt ?? ''))
        const q: ListQuery = {
          rows: [{ param: 'chips', value: chip }],
          split: 'tabsec',
          splitValues: [tab],
          order: tab === 'todo' ? (chip === 'all' ? 'overdue_rank' : 'overdue') : 'sort_asc',
          limit: BIG,
        }
        const got = await every<TutorFollowRow>(list, q)
        assert.equal(got.rowCounts.chips?.[chip] ?? 0, chipRows.length, `${scope}/${chip} chip count`)
        if (tab === 'todo') {
          assert.deepEqual(sqlIds(got), ids(want), `${scope}/${chip}/todo order`)
        } else {
          // Rows due at the same moment may come in either order; the set and the due order must hold.
          assert.deepEqual([...sqlIds(got)].sort(), ids(want).sort(), `${scope}/${chip}/sent rows`)
          const due = got.rows.map((r) => Date.parse(r.row.state.dueAt ?? ''))
          assert.ok(due.every((d, i) => i === 0 || d >= due[i - 1]), `${scope}/${chip}/sent soonest due first`)
          const noReply = await every<TutorFollowRow>(list, { ...q, splitValues: ['no_reply'], order: chip === 'all' ? 'overdue_rank' : 'pos' })
          assert.deepEqual(sqlIds(noReply), ids(inTab.filter((r) => r.state.section === 'no_reply')), `${scope}/${chip}/no reply`)
        }
      }
    }
    // Search: name or city, any case.
    const sample = rows.find((r) => (r.name ?? '').length >= 4)
    if (sample) {
      const needle = sample.name.slice(1, 4).toLowerCase()
      const want = rows.filter((r) => [r.name, r.city].some((v) => (v ?? '').toLowerCase().includes(needle)))
      const got = await every<TutorFollowRow>(list, { q: needle, limit: BIG })
      assert.deepEqual([...sqlIds(got)].sort(), ids(want).sort(), `${scope} search`)
    }
  }
})

test('Follow-ups → Parents: SQL counts, tabs and order equal the old rules on the same rows', { skip }, async () => {
  const all = (await stored<ParentFollowRow>(PARENT_FU_LIST)).map((s) => s.row)
  for (const ni of [false, true]) {
    const group = all.filter((r) => r.notInterested === ni)
    for (const chip of ['all', 'posted', 'not_posted', 'waiting', 'verified', 'not_submitted', 'rejected'] as ParentChip[]) {
      const chipped = group.filter((r) => parentChipMatch(chip, r))
      const todo = chipped.filter((r) => r.state.tab === 'todo').sort((a, b) => Number(b.state.overdue) - Number(a.state.overdue) || a.joinedAt.localeCompare(b.joinedAt))
      const pq = { fixed: { ni }, rows: [{ param: 'pchip', value: chip }], split: 'tabsec', limit: BIG }
      const gotTodo = await every<ParentFollowRow>(PARENT_FU_LIST, { ...pq, splitValues: ['todo'], order: 'overdue_sort' })
      assert.equal(gotTodo.rowCounts.pchip?.[chip] ?? 0, chipped.length, `parents ${ni}/${chip} chip count`)
      assert.deepEqual(sqlIds(gotTodo), ids(todo), `parents ${ni}/${chip} todo order`)
      const gotSent = await every<ParentFollowRow>(PARENT_FU_LIST, { ...pq, splitValues: ['sent'], order: 'pos' })
      assert.deepEqual(sqlIds(gotSent), ids(chipped.filter((r) => r.state.section === 'sent')), `parents ${ni}/${chip} sent`)
      const gotNr = await every<ParentFollowRow>(PARENT_FU_LIST, { ...pq, splitValues: ['no_reply'], order: 'pos' })
      assert.deepEqual(sqlIds(gotNr), ids(chipped.filter((r) => r.state.section === 'no_reply')), `parents ${ni}/${chip} no reply`)
    }
  }
})

test('People: the stored tabs hold the same people as the directory, with the same paid / posted split', { skip }, async () => {
  const dir = await loadDirectory()
  for (const role of ['tutor', 'parent'] as const) {
    const fresh = dir.people.filter((p) => p.role === role)
    const real = fresh.filter((p) => p.excluded === null)
    const all = await every(peopleList(role), { limit: BIG })
    sameSet(sqlIds(all), fresh.map((p) => p.id), `people ${role} (all)`)
    const shown = await every(peopleList(role), { fixed: { excluded: false }, limit: BIG })
    sameSet(sqlIds(shown), real.map((p) => p.id), `people ${role} (shown)`)
    if (role === 'tutor') {
      const paid = await every(peopleList(role), { fixed: { excluded: false, paid: 'paid' }, limit: BIG })
      sameSet(sqlIds(paid), real.filter((p) => p.feePaidAt).map((p) => p.id), 'people tutors paid')
    }
  }
})

test('Follow-ups: the stored lists hold the same members as a fresh load', { skip }, async () => {
  for (const scope of TUTOR_SCOPES) {
    const fresh = await loadTutorFollowUps(scope)
    sameSet((await stored<TutorFollowRow>(tutorFuList(scope))).map((s) => s.member_id), ids(fresh), `tutors ${scope}`)
  }
  const { rows } = await loadParentFollowUps()
  sameSet((await stored<ParentFollowRow>(PARENT_FU_LIST)).map((s) => s.member_id), ids(rows), 'parents')
})
