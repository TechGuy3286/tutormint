// scripts/test-staff-signups-live.ts — Sign-ups by staff (owner, 15 Oct 2026).
// LIVE (production data, read only): the board's milestone counts equal the
// same counts taken straight from the database, for every participant, every
// period and every step; every participant has a join link.
//   npx tsx --conditions=react-server --env-file=.env.local --test scripts/test-staff-signups-live.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

import { loadCreditedAccounts, loadSignupBoard } from '../lib/staffSignups'
import { PARENT_STEPS, PERIODS, TUTOR_STEPS, isParticipantRole, periodRange } from '../lib/staffSignupsCore'

const live = !!process.env.SUPABASE_DB_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY

const STEP_SQL: Record<string, string> = {
  signed_up: 'p.created_at',
  mobile_verified: 'p.phone_verified_at',
  onboarded: 'tp.onboarded_at',
  paid: `(select min(pay.reviewed_at) from payments pay where pay.user_id = c.member_id and pay.plan_code = 'verified'
           and pay.status = 'approved' and coalesce(pay.refunded_amount_pkr, 0) = 0 and pay.refunded_at is null)`,
  posted: '(select min(j.created_at) from jobs j where j.parent_id = c.member_id)',
}

test('every participant has a join link and code', { skip: !live }, async () => {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const { rows } = await c.query(
      `select p.id, p.admin_role, l.slug, l.code from profiles p left join staff_join_links l on l.staff_id = p.id
        where p.role = 'admin' and p.admin_role is not null and not coalesce(p.is_suspended, false)`,
    )
    for (const r of rows) if (isParticipantRole(r.admin_role)) assert.ok(r.slug && r.code, `link for ${r.id}`)
  } finally {
    await c.end()
  }
})

test('board counts match the database for every staff member, period and step', { skip: !live }, async () => {
  const now = Date.now()
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const accounts = await loadCreditedAccounts()
    const { rows: credits } = await c.query('select count(*)::int as n from staff_signup_credits')
    assert.equal(accounts.length, credits[0].n, 'every credit is loaded')
    for (const period of PERIODS) {
      const board = await loadSignupBoard({ id: 'test', adminRole: 'owner' }, period.key, now)
      const r = periodRange(period.key, now)
      for (const [role, steps] of [['tutor', TUTOR_STEPS], ['parent', PARENT_STEPS]] as const) {
        for (const s of steps) {
          const { rows } = await c.query(
            `select c.staff_id, count(*)::int as n
               from staff_signup_credits c
               join profiles p on p.id = c.member_id
               left join tutor_profiles tp on tp.id = c.member_id
              where c.member_role = $1 and ${STEP_SQL[s.key]} >= $2 and ${STEP_SQL[s.key]} < $3
              group by c.staff_id`,
            [role, new Date(r.start).toISOString(), new Date(r.end).toISOString()],
          )
          const want = new Map<string, number>(rows.map((x: { staff_id: string; n: number }) => [x.staff_id, x.n]))
          for (const row of board.rows) {
            const got = (role === 'tutor' ? row.tutor : row.parent) as Record<string, number>
            assert.equal(got[s.key], want.get(row.staffId) ?? 0, `${row.name} ${role} ${s.key} ${period.key}`)
          }
          const total = (role === 'tutor' ? board.total!.tutor : board.total!.parent) as Record<string, number>
          const sum = ([...want.values()] as number[]).reduce((a, b) => a + b, 0)
          assert.equal(total[s.key], sum, `team ${role} ${s.key} ${period.key}`)
        }
      }
    }
  } finally {
    await c.end()
  }
})
