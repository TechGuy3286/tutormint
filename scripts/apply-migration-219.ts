/**
 * scripts/apply-migration-219.ts — applies supabase/migrations/219_admin_list_page.sql.
 * One transaction; without --apply it rolls back. Runs the file twice, then in a
 * rolled-back savepoint inserts made-up rows into a throwaway list and checks
 * the search, chip counts, split, ordering and paging; and checks anon and
 * authenticated cannot call the function. Prints results only.
 *
 *   npx tsx --env-file=.env.local scripts/apply-migration-219.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const L = 'zz_probe_list'
const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004']

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/219_admin_list_page.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  await c.query(`set local lock_timeout = '5s'`)
  try {
    await c.query(sql)
    await c.query(sql)
    await c.query('savepoint probe')
    const ins = `insert into admin_list_rows (list, member_id, pos, search, digits, tags, sort_at, row) values ($1,$2,$3,$4,$5,$6,$7,$8)`
    await c.query(ins, [L, ids[0], 0, 'ali raza lahore', '923001111111', { paid: 'paid', docs: 'waiting', excluded: false, chips: ['a', 'b'], overdue: 'false', rank: '2' }, '2026-10-03T00:00:00Z', { n: 0 }])
    await c.query(ins, [L, ids[1], 1, 'sara khan karachi', '923002222222', { paid: 'unpaid', docs: 'waiting', excluded: false, chips: ['b'], overdue: 'true', rank: '1' }, '2026-10-01T00:00:00Z', { n: 1 }])
    await c.query(ins, [L, ids[2], 2, 'usman ali lahore', '923003333333', { paid: 'paid', docs: 'approved', excluded: false, chips: [], overdue: 'false', rank: '0' }, null, { n: 2 }])
    await c.query(ins, [L, ids[3], 3, 'hidden test', '', { paid: 'paid', docs: 'none', excluded: true, chips: ['a'], overdue: 'false', rank: '0' }, null, { n: 3 }])
    const call = async (args: Record<string, unknown>) =>
      (
        await c.query(
          `select public.admin_list_page($1, $2::jsonb, $3, $4, $5, $6, $7::jsonb, $8, $9::text[], $10, $11, $12) r`,
          [L, JSON.stringify(args.fixed ?? {}), null, null, args.needle ?? '', args.digits ?? '', JSON.stringify(args.rows ?? []), args.split ?? null, args.splitValues ?? null, args.order ?? 'pos', args.offset ?? 0, args.limit ?? 25],
        )
      ).rows[0].r
    const r1 = await call({ fixed: { excluded: false }, rows: [{ param: 'paid', value: 'paid' }], split: 'docs' })
    assert.equal(r1.all, 3)
    assert.equal(r1.searched, 3)
    assert.deepEqual(r1.rowCounts.paid, { all: 3, paid: 2, unpaid: 1 })
    assert.deepEqual(r1.split, { waiting: 1, approved: 1 })
    assert.equal(r1.total, 2)
    assert.deepEqual(r1.rows.map((x: { row: { n: number } }) => x.row.n), [0, 2])
    // Search by name and by 4+ digits.
    const r2 = await call({ fixed: { excluded: false }, needle: 'lahore' })
    assert.equal(r2.searched, 2)
    const r3 = await call({ fixed: { excluded: false }, needle: '2222', digits: '2222' })
    assert.equal(r3.searched, 1)
    // Array tags (chips): counted per value, and narrowed by containment.
    const r4 = await call({ rows: [{ param: 'chips', value: 'b' }] })
    assert.deepEqual(r4.rowCounts.chips, { all: 4, a: 2, b: 2 })
    assert.equal(r4.total, 2)
    // Orders: waiting oldest first; overdue then rank.
    const r5 = await call({ fixed: { excluded: false }, split: 'docs', splitValues: ['waiting'], order: 'sort_asc' })
    assert.deepEqual(r5.rows.map((x: { row: { n: number } }) => x.row.n), [1, 0])
    const r6 = await call({ fixed: { excluded: false }, order: 'overdue_rank' })
    assert.deepEqual(r6.rows.map((x: { row: { n: number } }) => x.row.n), [1, 2, 0])
    // Paging.
    const r7 = await call({ fixed: { excluded: false }, offset: 1, limit: 1 })
    assert.equal(r7.total, 3)
    assert.deepEqual(r7.rows.map((x: { row: { n: number } }) => x.row.n), [1])
    // A quote in the search cannot break out of the query.
    const r8 = await call({ needle: "o'brien'); drop table admin_list_rows; --" })
    assert.equal(r8.searched, 0)
    await c.query('rollback to savepoint probe')
    console.log('made-up rows: search, chip counts, split, order and paging all correct')
    for (const role of ['anon', 'authenticated']) {
      await c.query('savepoint probe2')
      await c.query(`set local role ${role}`)
      let refused = false
      try {
        await c.query(`select public.admin_list_page('x')`)
      } catch {
        refused = true
      }
      await c.query('rollback to savepoint probe2')
      if (!refused) throw new Error(`${role} can call admin_list_page`)
    }
    console.log('anon and authenticated cannot call admin_list_page')
    if (apply) {
      await c.query('commit')
      console.log('APPLIED')
    } else {
      await c.query('rollback')
      console.log('DRY RUN — rolled back')
    }
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e)
  process.exit(1)
})
