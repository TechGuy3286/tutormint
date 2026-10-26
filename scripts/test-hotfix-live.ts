// scripts/test-hotfix-live.ts — hotfix, 26 Oct 2026. LIVE, writes nothing:
// every write is inside a savepoint that is rolled back, and the bank link is a
// dry run (linkCreditToMember returns before any insert). Prints no name,
// phone, email, reference or account number.
//
//   npm run test:hotfix:live

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

import { linkableCredits, linkCreditToMember } from '@/lib/bankPaymentLink'

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 20000 })
const ready = c.connect()
after(() => c.end())

async function probe(sessionId: string, viewAs: boolean) {
  await ready
  await c.query('begin')
  try {
    const tutor = (await c.query(`select id from profiles where role = 'tutor' and coalesce(is_seed,false) = false order by created_at limit 1`)).rows[0].id as string
    const owner = (await c.query(`select id from profiles where admin_role = 'owner' limit 1`)).rows[0].id as string
    if (viewAs) await c.query(`insert into view_as_sessions (owner_id, member_id, session_id, expires_at) values ($1, $2, $3, now() + interval '30 minutes')`, [owner, tutor, sessionId])
    await c.query(`set local role authenticated`)
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: tutor, role: 'authenticated', session_id: sessionId })])
    const upd = await c.query(`update profiles set full_name = full_name where id = $1`, [tutor])
    let storageOk = true
    await c.query('savepoint s')
    try {
      await c.query(`insert into storage.objects (bucket_id, name, owner, owner_id) values ('avatars', $1, $2, $3)`, [`${tutor}/hotfix-probe-${randomUUID()}.jpg`, tutor, tutor])
    } catch {
      storageOk = false
    }
    await c.query('rollback to savepoint s')
    let docOk = true
    await c.query('savepoint d')
    try {
      await c.query(`insert into storage.objects (bucket_id, name, owner, owner_id) values ('identity-docs', $1, $2, $3)`, [`${tutor}/hotfix-probe-${randomUUID()}.jpg`, tutor, tutor])
    } catch {
      docOk = false
    }
    await c.query('rollback to savepoint d')
    return { rows: upd.rowCount as number, storageOk, docOk }
  } finally {
    await c.query('rollback')
  }
}

test('View-as: a write from a View-as session is refused (profile update, storage upload)', async () => {
  const r = await probe(randomUUID(), true)
  assert.equal(r.rows, 0)
  assert.equal(r.storageOk, false)
  assert.equal(r.docOk, false)
})

test('normal sessions: the same profile update and uploads go through', async () => {
  const r = await probe(randomUUID(), false)
  assert.equal(r.rows, 1)
  assert.equal(r.storageOk, true, 'avatar upload')
  assert.equal(r.docOk, true, 'identity document upload')
})

test('Record a bank payment: an unmatched hand-entered credit can be recorded for an unpaid tutor (dry run)', async () => {
  await ready
  const credits = await linkableCredits()
  assert.ok(credits, 'the credit list loads')
  const owner = (await c.query(`select id from profiles where admin_role = 'owner' limit 1`)).rows[0].id as string
  const manual = (await c.query(`select id from bank_transfers where source = 'manual' and coalesce(gateway, 'manual') <> 'paypro'`)).rows.map((r: { id: string }) => r.id)
  const credit = credits!.find((x) => manual.includes(x.id) && !x.isPaypro && x.amountPkr >= 199)
  assert.ok(credit, 'there is an unmatched hand-entered credit to try')
  const unpaid = (
    await c.query(
      `select p.id from profiles p join tutor_profiles tp on tp.id = p.id
        where p.role = 'tutor' and tp.verified_fee_paid_at is null and coalesce(p.is_seed,false) = false
          and not exists (select 1 from payments x where x.user_id = p.id and x.plan_code = 'verified' and x.status = 'approved')
        order by p.created_at desc limit 1`,
    )
  ).rows[0]?.id as string
  assert.ok(unpaid)
  const t0 = Date.now()
  const res = await linkCreditToMember({ transferId: credit!.id, memberId: unpaid, planCode: 'verified', amountPkr: 199 }, { id: owner, adminRole: 'owner', email: null }, { dryRun: true })
  assert.equal(res.ok, true, JSON.stringify(res))
  assert.ok('dryRun' in res && res.dryRun && res.mode === 'activate')
  console.log(`dry-run link: ${Date.now() - t0} ms`)
})
