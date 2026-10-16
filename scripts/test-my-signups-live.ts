// scripts/test-my-signups-live.ts — "My sign-ups" (owner, 16 Oct 2026).
// LIVE (production data, read only; every database session is rolled back):
//   • the database refuses another staff member's sign-ups to a staff token;
//   • every participant's My sign-ups numbers equal their Team activity numbers;
//   • staff not on this month's target list get no target or pace;
//   • no live row carries a forbidden field.
//   npx tsx --conditions=react-server --env-file=.env.local --test scripts/test-my-signups-live.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

import { loadCreditedAccounts } from '../lib/staffSignups'
import { loadTargetBoard } from '../lib/staffTargets'
import { loadMyMonthCard, loadMySignups } from '../lib/mySignups'
import { FORBIDDEN_FIELD, MY_SIGNUP_ROW_KEYS, countedInMonth } from '../lib/mySignupsCore'
import { isParticipantRole } from '../lib/staffSignupsCore'
import { monthKeyOf } from '../lib/staffTargetsCore'

const live = !!process.env.SUPABASE_DB_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY

type Staff = { id: string; full_name: string; admin_role: string }

async function withDb<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.end()
  }
}

async function staffList(): Promise<Staff[]> {
  return withDb(async (c) => (await c.query(`select id, full_name, admin_role from profiles where role = 'admin' and admin_role is not null`)).rows as Staff[])
}

test('RLS: a staff token reads only its own sign-ups', { skip: !live }, async () => {
  await withDb(async (c) => {
    const staff = (await c.query(`select id, admin_role from profiles where role = 'admin' and admin_role is not null`)).rows as Staff[]
    for (const s of staff) {
      if (!isParticipantRole(s.admin_role) || s.admin_role === 'admin') continue
      await c.query('begin')
      try {
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: s.id, role: 'authenticated' })])
        await c.query('set local role authenticated')
        for (const table of ['staff_signup_credits', 'staff_signup_claims', 'staff_join_links', 'staff_referral_visits']) {
          const r = (await c.query(`select count(*)::int n from ${table} where staff_id <> $1`, [s.id])).rows[0]
          assert.equal(r.n, 0, `${table} leaks to ${s.id}`)
        }
      } finally {
        await c.query('rollback')
      }
    }
  })
})

test('My sign-ups numbers equal Team activity for every participant', { skip: !live }, async () => {
  const now = Date.now()
  const month = monthKeyOf(now)
  const accounts = await loadCreditedAccounts()
  const board = await loadTargetBoard({ id: 'test', adminRole: 'owner' }, month, now)
  for (const s of await staffList()) {
    if (!isParticipantRole(s.admin_role)) continue
    const team = board.cards.find((c) => c.staffId === s.id)?.pace.paid ?? board.noTarget.find((r) => r.staffId === s.id)?.paid ?? 0
    const card = await loadMyMonthCard(s.id, now)
    const mine = card.kind === 'target' ? card.card.pace.paid : card.paid
    assert.equal(mine, team, `${s.full_name}: My sign-ups ${mine} vs Team activity ${team}`)
    // The target card is the same object Team activity shows.
    if (card.kind === 'target') {
      const t = board.cards.find((c) => c.staffId === s.id)!
      assert.deepEqual(card.card.pace, t.pace, `${s.full_name}: pace`)
    } else {
      assert.ok(!board.cards.some((c) => c.staffId === s.id), `${s.full_name} is on the list but got no target`)
    }
    const rows = await loadMySignups(s.id, accounts)
    assert.equal(countedInMonth(rows, now), team, `${s.full_name}: counted rows`)
    assert.equal(rows.filter((r) => r.kind === 'credit').length, accounts.filter((a) => a.staffId === s.id).length, `${s.full_name}: one row per credit`)
    for (const r of rows) {
      assert.deepEqual(Object.keys(r).sort(), [...MY_SIGNUP_ROW_KEYS].sort())
      for (const k of Object.keys(r)) assert.ok(!FORBIDDEN_FIELD.test(k))
      assert.equal(r.staffId, s.id, 'only their own people')
    }
    console.log(`${s.full_name}: ${rows.length} rows, paid this month ${mine} (${card.kind})`)
  }
})
