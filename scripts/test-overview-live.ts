// scripts/test-overview-live.ts — owner, 8 Oct 2026, item 5.
//
// For EVERY Overview top card, "Today's to-do" row and "Signup to payment"
// step (and each step's "lost" figure): the number the Overview shows equals
// the number of rows in the list it opens. Both come from one loader
// (lib/overviewItems.loadOverviewList); this checks that the loader's rows are
// distinct, that the revenue card's amount is the sum of its rows, and — where
// an independent count exists — that the list agrees with a separate query.
// LIVE (production data, read only):
//   npx tsx --conditions=react-server --env-file=.env.local --test scripts/test-overview-live.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { loadOverviewList } from '../lib/overviewItems'
import { OVERVIEW_ITEM_KEYS, OVERVIEW_ITEMS, funnelSets } from '../lib/overviewItemsCore'
import { createAdminClient } from '../lib/supabase/admin'

const live = !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.NEXT_PUBLIC_SUPABASE_URL

test('the Overview reads every number from the item list it links to', () => {
  const page = readFileSync('app/admin/page.tsx', 'utf8')
  assert.ok(page.includes("value: k === 'revenue' ? pkr(l.amount ?? 0) : String(l.rows.length)"))
  assert.ok(page.includes('count: lists.get(k)!.rows.length'))
  assert.ok(page.includes('lists.get(k)?.rows.length ?? 0'))
  assert.ok(page.includes('lists.get(lost)?.rows.length ?? 0'))
  assert.ok(page.includes('`/admin/overview/${k}'))
  const list = readFileSync('app/admin/overview/[key]/page.tsx', 'utf8')
  assert.ok(list.includes('await loadOverviewList(key, { days })'))
})

for (const days of [7, 30] as const) {
  test(`every item: count = rows, rows distinct (funnel ${days} days)`, { skip: !live }, async () => {
    for (const key of OVERVIEW_ITEM_KEYS) {
      if (!OVERVIEW_ITEMS[key].funnel && days === 30) continue
      const a = await loadOverviewList(key, { days })
      const b = await loadOverviewList(key, { days })
      // The Overview and the list page each call the loader: same count.
      assert.equal(a.rows.length, b.rows.length, `${key}: two loads disagree`)
      assert.equal(new Set(a.rows.map((r) => r.id)).size, a.rows.length, `${key}: duplicate rows`)
      if (key === 'revenue') {
        const sum = Math.round(a.rows.reduce((s, r) => s + (r.amount ?? 0), 0) * 100) / 100
        assert.equal(a.amount, sum, 'revenue card = sum of its list')
      }
      console.log(`  ${key}${OVERVIEW_ITEMS[key].funnel ? ` (${days}d)` : ''}: ${a.rows.length}${a.amount !== undefined ? ` · Rs ${a.amount}` : ''}`)
    }
  })

  test(`funnel "lost" figures equal the step differences (${days} days)`, { skip: !live }, async () => {
    const n = async (k: Parameters<typeof loadOverviewList>[0]) => (await loadOverviewList(k, { days })).rows.length
    const [s, m, o, p] = await Promise.all([n('funnel-signed-up'), n('funnel-mobile'), n('funnel-onboarded'), n('funnel-paid')])
    assert.equal(await n('lost-mobile'), s - m)
    assert.equal(await n('lost-onboarding'), m - o)
    assert.equal(await n('lost-payment'), o - p)
    assert.ok(funnelSets([]).signedUp.length === 0)
  })
}

test('lists agree with independent counts', { skip: !live }, async () => {
  const admin = createAdminClient()!
  const head = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0
  assert.equal((await loadOverviewList('tutors')).rows.length, await head(admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'tutor')))
  assert.equal(
    (await loadOverviewList('parents')).rows.length,
    await head(admin.from('profiles').select('id', { count: 'exact', head: true }).in('role', ['parent', 'academy'])),
  )
  assert.equal((await loadOverviewList('open-tuitions')).rows.length, await head(admin.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'open')))
  // Item 6: pending, started in the last 24 hours, waiting over 1 hour.
  const now = Date.now()
  const waiting = await head(
    admin
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .gte('created_at', new Date(now - 24 * 3600_000).toISOString())
      .lt('created_at', new Date(now - 3600_000).toISOString()),
  )
  assert.equal((await loadOverviewList('todo-payments')).rows.length, waiting)
  const flags = await head(admin.from('abuse_flags').select('id', { count: 'exact', head: true }).eq('status', 'open'))
  const reports = await head(admin.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open'))
  assert.equal((await loadOverviewList('todo-flagged')).rows.length, flags + reports)
})
