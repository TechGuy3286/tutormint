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
  // The six square cards (owner, 17 Oct 2026) read each item's own figures.
  assert.ok(page.includes('card: l.card ?? {'))
  assert.ok(page.includes('count: lists.get(k)!.rows.length'))
  assert.ok(page.includes('lists.get(k)?.rows.length ?? 0'))
  assert.ok(page.includes('lists.get(lost)?.rows.length ?? 0'))
  assert.ok(page.includes('`/admin/overview/${k}'))
  const list = readFileSync('app/admin/overview/[key]/page.tsx', 'utf8')
  assert.ok(list.includes('await loadOverviewList(key, { days, period })'))
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
  assert.equal((await loadOverviewList('tutors')).rows.length, await head(admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'tutor').eq('is_test_name', false)))
  assert.equal(
    (await loadOverviewList('parents')).rows.length,
    await head(admin.from('profiles').select('id', { count: 'exact', head: true }).in('role', ['parent', 'academy']).eq('is_test_name', false)),
  )
  // Test-named accounts and their tuitions are not counted (owner, 8 Oct 2026).
  const { data: testRows } = await admin.from('profiles').select('id').eq('is_test_name', true)
  const testIds = (testRows ?? []).map((r) => r.id as string)
  let openQ = admin.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'open')
  if (testIds.length) openQ = openQ.not('parent_id', 'in', `(${testIds.join(',')})`)
  assert.equal((await loadOverviewList('open-tuitions')).rows.length, await head(openQ))
  // "Started payment, didn't finish" (16 Oct 2026, replaced "Payments waiting
  // over 1 hour"): pending checkouts 1–48 hours old with no receipt, one per
  // member and package. Every row is one of those checkouts, and no member +
  // package appears twice.
  const now = Date.now()
  const { data: pend } = await admin
    .from('payments')
    .select('id, user_id, plan_code, screenshot_path, reference')
    .eq('status', 'pending')
    .gte('created_at', new Date(now - 48 * 3600_000).toISOString())
    .lt('created_at', new Date(now - 3600_000).toISOString())
  const candidates = new Map(
    (pend ?? [])
      .filter((p) => p.user_id && !p.screenshot_path && !String(p.reference ?? '').trim())
      .map((p) => [p.id as string, `${p.user_id}|${p.plan_code}`]),
  )
  const started = (await loadOverviewList('todo-payments')).rows
  for (const r of started) assert.ok(candidates.has(r.id), `todo-payments: ${r.id} is not a pending 1–48 h checkout`)
  const pairs = started.map((r) => candidates.get(r.id))
  assert.equal(new Set(pairs).size, pairs.length, 'todo-payments: one row per member and package')
  assert.ok(started.length <= new Set(candidates.values()).size)
  const flags = await head(admin.from('abuse_flags').select('id', { count: 'exact', head: true }).eq('status', 'open'))
  const reports = await head(admin.from('reports').select('id', { count: 'exact', head: true }).eq('status', 'open'))
  assert.equal((await loadOverviewList('todo-flagged')).rows.length, flags + reports)
})

// The square cards (owner, 17 Oct 2026): Today / Yesterday / Last 7 days and
// the bottom line, each checked against the item's own list or a separate query.
const PK = 5 * 3600_000
const dayStart = (ms: number) => {
  const d = new Date(ms + PK)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - PK
}

test('square cards: every card has its three figures and the right bottom line', { skip: !live }, async () => {
  const want: Record<string, string | null> = {
    revenue: 'This month',
    'paid-today': 'This month',
    tutors: 'Total',
    parents: 'Total',
    'open-tuitions': 'Open now',
    'signups-today': null,
  }
  for (const [key, bottom] of Object.entries(want)) {
    const l = await loadOverviewList(key as Parameters<typeof loadOverviewList>[0])
    assert.ok(l.card, `${key}: no card figures`)
    for (const v of [l.card!.today, l.card!.yesterday, l.card!.last7]) assert.match(v, /^(Rs )?\d{1,3}(,\d{3})*$/, `${key}: ${v}`)
    assert.equal(l.card!.bottom?.label ?? null, bottom, `${key}: bottom line`)
    console.log(`  ${key}: today ${l.card!.today} · yesterday ${l.card!.yesterday} · last 7 days ${l.card!.last7}${l.card!.bottom ? ` · ${l.card!.bottom.label} ${l.card!.bottom.value}` : ''}`)
  }
})

test('square cards agree with their lists and with independent counts', { skip: !live }, async () => {
  const admin = createAdminClient()!
  const now = Date.now()
  const today = dayStart(now)
  const n = (v: string) => Number(v.replace(/[^\d]/g, ''))
  // Bottom lines = the list the card opens.
  const tutors = await loadOverviewList('tutors')
  assert.equal(n(tutors.card!.bottom!.value), tutors.rows.length)
  const parents = await loadOverviewList('parents')
  assert.equal(n(parents.card!.bottom!.value), parents.rows.length)
  const open = await loadOverviewList('open-tuitions')
  assert.equal(n(open.card!.bottom!.value), open.rows.length)
  const revenue = await loadOverviewList('revenue')
  assert.equal(n(revenue.card!.bottom!.value), Math.round(revenue.amount ?? 0))
  // Today = the list for the two "today" cards.
  const paid = await loadOverviewList('paid-today')
  assert.equal(n(paid.card!.today), paid.rows.length)
  const signups = await loadOverviewList('signups-today')
  assert.equal(n(signups.card!.today), signups.rows.length)
  // New tutors today / yesterday / last 7 days against a separate query.
  const count = async (role: string[], from: number, to: number) =>
    (
      await admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .in('role', role)
        .eq('is_test_name', false)
        .gte('created_at', new Date(from).toISOString())
        .lt('created_at', new Date(to).toISOString())
    ).count ?? 0
  assert.equal(n(tutors.card!.today), await count(['tutor'], today, now + 1))
  assert.equal(n(tutors.card!.yesterday), await count(['tutor'], today - 86_400_000, today))
  assert.equal(n(tutors.card!.last7), await count(['tutor'], today - 6 * 86_400_000, now + 1))
  assert.equal(n(parents.card!.yesterday), await count(['parent', 'academy'], today - 86_400_000, today))
  // Tuitions posted counts every tuition posted, open or not (test accounts out).
  const { data: testRows } = await admin.from('profiles').select('id').eq('is_test_name', true)
  const testIds = new Set((testRows ?? []).map((r) => r.id as string))
  const { data: jobs } = await admin.from('jobs').select('id, parent_id').gte('created_at', new Date(today - 6 * 86_400_000).toISOString())
  assert.equal(n(open.card!.last7), (jobs ?? []).filter((j) => !testIds.has(j.parent_id as string)).length)
})
