/**
 * scripts/apply-migration-202.ts — applies supabase/migrations/202_job_subjects_master_index.sql.
 * One transaction; without --apply it rolls back.
 *
 * Checks (all writes are inside savepoints that are rolled back; nothing a
 * member could see is ever stored):
 *   - the plan of a subject lookup on job_subjects before and after the index;
 *   - job_subjects rows unchanged;
 *   - with a View-as session id in the JWT claims, a signed-in tutor can NOT
 *     update their own profile row or insert a storage object in their own
 *     avatars folder (migration 201's restrictive policies);
 *   - with any other session id the same two writes ARE allowed;
 *   - the time the View-as check adds to a write (same update, EXPLAIN ANALYZE).
 * Prints counts, plans and timings only — never a name, phone, email or value.
 *
 *   npx tsx --env-file=.env.local scripts/apply-migration-202.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/202_job_subjects_master_index.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await c.connect()
  await c.query('begin')
  await c.query(`set local lock_timeout = '5s'`)
  try {
    const masters = (await c.query(`select array_agg(master_id) a from (select master_id from job_subjects group by 1 order by count(*) desc limit 20) x`)).rows[0].a as number[]
    const plan = async () =>
      (await c.query(`explain (analyze, costs off, timing on) select job_id from job_subjects where master_id = any($1::int[])`, [masters])).rows
        .map((r: Record<string, string>) => r['QUERY PLAN'])
        .join('\n    ')
    const fp = async () => (await c.query(`select count(*)::int n, md5(coalesce(string_agg(job_id::text || ':' || master_id, ',' order by job_id, master_id), '')) m from job_subjects`)).rows[0]
    const before = await fp()
    console.log('subject lookup BEFORE:\n    ' + (await plan()))
    await c.query(sql)
    await c.query(sql)
    console.log('subject lookup AFTER:\n    ' + (await plan()))
    const after = await fp()
    if (before.n !== after.n || before.m !== after.m) throw new Error('job_subjects rows changed')
    console.log('job_subjects rows unchanged:', after.n)

    // ── View-as still refuses writes; normal sessions still write ──────────
    const tutor = (await c.query(`select id from profiles where role = 'tutor' and coalesce(is_seed,false) = false order by created_at limit 1`)).rows[0].id as string
    const owner = (await c.query(`select id from profiles where admin_role = 'owner' limit 1`)).rows[0].id as string
    const viewSession = randomUUID()
    const otherSession = randomUUID()

    const asTutor = async (sessionId: string) => {
      await c.query(`set local role authenticated`)
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: tutor, role: 'authenticated', session_id: sessionId })])
    }
    const probe = async (label: string, sessionId: string, withViewAsRow: boolean) => {
      await c.query('savepoint p')
      try {
        if (withViewAsRow) {
          await c.query(`insert into view_as_sessions (owner_id, member_id, session_id, expires_at) values ($1, $2, $3, now() + interval '30 minutes')`, [owner, tutor, viewSession])
        }
        await asTutor(sessionId)
        const upd = await c.query(`update profiles set full_name = full_name where id = $1`, [tutor])
        let storage = 'allowed'
        await c.query('savepoint s')
        try {
          await c.query(`insert into storage.objects (bucket_id, name, owner, owner_id) values ('avatars', $1, $2, $3)`, [`${tutor}/hotfix-probe-${randomUUID()}.jpg`, tutor, tutor])
        } catch (e) {
          storage = `refused (${(e as Error).message.slice(0, 60)})`
        }
        await c.query('rollback to savepoint s')
        console.log(`${label}: profile update rows=${upd.rowCount}, storage insert ${storage}`)
        return { rows: upd.rowCount as number, storage }
      } finally {
        await c.query('rollback to savepoint p')
      }
    }
    const blocked = await probe('View-as session', viewSession, true)
    const normal = await probe('normal session', otherSession, true)
    if (blocked.rows !== 0 || blocked.storage === 'allowed') throw new Error('a View-as session was able to write')
    if (normal.rows !== 1 || normal.storage !== 'allowed') throw new Error('a normal session could not write')

    // ── what the View-as check costs on a write ────────────────────────────
    await c.query('savepoint t')
    await asTutor(otherSession)
    const times: number[] = []
    for (let i = 0; i < 30; i++) {
      const r = await c.query(`explain (analyze, format json) update profiles set full_name = full_name where id = $1`, [tutor])
      times.push(r.rows[0]['QUERY PLAN'][0]['Execution Time'])
    }
    const fnTimes: number[] = []
    for (let i = 0; i < 30; i++) {
      const r = await c.query(`explain (analyze, format json) select public.is_view_as_session()`)
      fnTimes.push(r.rows[0]['QUERY PLAN'][0]['Execution Time'])
    }
    await c.query('rollback to savepoint t')
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
    console.log(`own-profile update (all policies + triggers): median ${med(times).toFixed(3)} ms; is_view_as_session(): median ${med(fnTimes).toFixed(3)} ms`)

    if (apply) {
      await c.query('commit')
      console.log('APPLIED migration 202')
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
  console.error(e)
  process.exit(1)
})
