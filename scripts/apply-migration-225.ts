/**
 * scripts/apply-migration-225.ts — applies supabase/migrations/225_photo_blank_checks.sql.
 * One transaction; without --apply it rolls back. Every behaviour check runs in
 * a savepoint that is rolled back, so nothing it tries is kept even with --apply.
 * Prints counts only — never a name, number, address or image.
 *   npx tsx --env-file=.env.local scripts/apply-migration-225.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

type C = { query: (q: string, v?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }> }

async function asMember(c: C, id: string, fn: () => Promise<void>): Promise<string | null> {
  await c.query('savepoint t')
  try {
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id, role: 'authenticated' })])
    await c.query('set local role authenticated')
    await fn()
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  } finally {
    await c.query('rollback to savepoint t')
  }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/225_photo_blank_checks.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 })
  await c.connect()
  await c.query('begin')
  try {
    await c.query(sql)
    await c.query(sql) // re-runnable

    const rls = await c.query(`select relrowsecurity r from pg_class where oid = 'public.photo_blank_checks'::regclass`)
    assert.equal(rls.rows[0].r, true, 'RLS on')
    const pols = await c.query(`select polname from pg_policy where polrelid = 'public.photo_blank_checks'::regclass order by polname`)
    console.log('policies:', pols.rows.map((r: Record<string, unknown>) => r.polname).join(', '))

    // A real tutor's own token cannot write or read the table.
    const t = await c.query(`select id from profiles where role = 'tutor' and coalesce(is_suspended,false) = false limit 1`)
    const tid = t.rows[0]?.id as string | undefined
    if (tid) {
      const ins = await asMember(c, tid, async () => {
        await c.query(`insert into public.photo_blank_checks (member_id, item, ref, blank) values ($1, 'photo', 'invented-ref', true)`, [tid])
      })
      assert.ok(ins, 'a member insert is refused')
      let seen = -1
      const rd = await asMember(c, tid, async () => {
        seen = (await c.query(`select count(*)::int n from public.photo_blank_checks`)).rows[0].n as number
      })
      assert.equal(rd, null)
      assert.equal(seen, 0, 'a member reads nothing')
      console.log('member write refused; member reads 0 rows')
    }
    const n = await c.query(`select count(*)::int n from public.photo_blank_checks`)
    console.log('rows in table:', n.rows[0].n)

    if (apply) {
      await c.query('commit')
      console.log('APPLIED')
    } else {
      await c.query('rollback')
      console.log('dry run — rolled back')
    }
  } catch (e) {
    await c.query('rollback').catch(() => null)
    throw e
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
