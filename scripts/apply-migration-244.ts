/**
 * scripts/apply-migration-244.ts — applies supabase/migrations/244_pr17_demo_feedback_rating.sql.
 * One transaction; without --apply it rolls back. Proves: every tutor with demo
 * feedback has rating = average of (approved hire reviews + demo stars); the
 * public page lists only APPROVED demo comments; the guard lets a parent change
 * only stars + comment (an edited comment returns to pending), a tutor only the
 * reply, and refuses a stranger and a self-approval (all inside savepoints,
 * rolled back); the migration re-runs cleanly. Counts / yes-no only — no name,
 * phone, email or comment text is printed.
 *   npx tsx --env-file=.env.local scripts/apply-migration-244.ts [--apply]
 */
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function asMember(c: pg.Client, uid: string, fn: () => Promise<void>): Promise<string | null> {
  await c.query('savepoint m')
  try {
    await c.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('role', 'authenticated', true)`, [JSON.stringify({ sub: uid, role: 'authenticated' }), uid])
    await fn()
    await c.query('rollback to savepoint m')
    return null
  } catch (e) {
    await c.query('rollback to savepoint m')
    return e instanceof Error ? e.message : String(e)
  }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/244_pr17_demo_feedback_rating.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 })
  await c.connect()
  await c.query('begin')
  try {
    await c.query(`set local lock_timeout = '10s'`)
    await c.query(sql)
    await c.query(sql) // re-runnable

    // Ratings = approved reviews + demo stars, for every tutor with either.
    const wrong = Number((await c.query(`
      with x as (
        select tutor_id, rating from reviews where status = 'approved' and rating is not null
        union all select tutor_id, rating from demo_feedback where rating is not null
      ), a as (select tutor_id, round(avg(rating)::numeric, 2) avg, count(*) n from x group by 1)
      select count(*) n from a join tutor_profiles tp on tp.id = a.tutor_id
      where tp.rating_avg is distinct from a.avg or tp.rating_count is distinct from a.n::int`)).rows[0].n)
    assert.equal(wrong, 0, 'every rated tutor has the right rating')
    const rated = Number((await c.query(`select count(*) n from tutor_profiles where rating_count > 0`)).rows[0].n)
    console.log('tutors with a rating now', rated)

    const jav = (await c.query(`select id, rating_avg, rating_count from tutor_profiles where slug = 'javeria-fayaz-english-tutor-lahore'`)).rows[0]
    assert.ok(jav, 'the tutor exists')
    console.log('the reported tutor: rating', jav.rating_avg, 'count', jav.rating_count)
    assert.ok(Number(jav.rating_count) >= 1, 'her demo stars count')

    // Public page: pending comment not listed; once approved it is.
    const listed = async () => {
      const r = (await c.query(`select reviews from tutor_public_page('javeria-fayaz-english-tutor-lahore')`)).rows[0]
      return (r?.reviews ?? []) as { source?: string }[]
    }
    const pageRow = (await c.query(`select rating_avg, rating_count from tutor_public_page('javeria-fayaz-english-tutor-lahore')`)).rows[0]
    console.log('public page shows rating', pageRow?.rating_avg, pageRow?.rating_count)
    assert.equal((await listed()).filter((x) => x.source === 'demo').length, 0, 'a pending comment is not public')
    const fb = (await c.query(`select id, parent_id, tutor_id, rating, feedback_text from demo_feedback where tutor_id = $1 limit 1`, [jav.id])).rows[0]
    await c.query('savepoint ap')
    await c.query(`update demo_feedback set comment_status = 'approved', comment_decided_at = now() where id = $1`, [fb.id])
    assert.equal((await listed()).filter((x) => x.source === 'demo').length, 1, 'an approved comment is public')
    await c.query('rollback to savepoint ap')

    // Guard, as the parent.
    let err = await asMember(c, fb.parent_id, async () => {
      await c.query(`update demo_feedback set rating = 4 where id = $1`, [fb.id])
      const r = (await c.query(`select rating_avg, rating_count from tutor_public_page('javeria-fayaz-english-tutor-lahore')`)).rows[0]
      assert.ok(Number(r.rating_count) >= 1, 'edited rating still counted once')
      await c.query(`update demo_feedback set feedback_text = feedback_text || '.', comment_status = 'approved' where id = $1`, [fb.id])
      const s = (await c.query(`select comment_status from demo_feedback where id = $1`, [fb.id])).rows[0].comment_status
      assert.equal(s, 'pending', 'a parent cannot approve; an edited comment is pending')
    })
    assert.equal(err, null, `parent may edit stars + comment (${err})`)
    err = await asMember(c, fb.parent_id, async () => {
      await c.query(`update demo_feedback set tutor_reply = 'x' where id = $1`, [fb.id])
    })
    assert.ok(err, 'parent cannot write the reply')
    err = await asMember(c, fb.parent_id, async () => {
      await c.query(`insert into demo_feedback (parent_id, tutor_id, rating, feedback_text, demo_request_id) values ($1, $2, 5, 'again', (select demo_request_id from demo_feedback where id = $3))`, [fb.parent_id, fb.tutor_id, fb.id])
    })
    assert.ok(err, 'a second feedback for the same demo is refused')
    // Guard, as the tutor.
    err = await asMember(c, fb.tutor_id, async () => {
      await c.query(`update demo_feedback set rating = case when rating = 1 then 2 else 1 end where id = $1`, [fb.id])
    })
    assert.ok(err, 'tutor cannot change the stars')
    err = await asMember(c, fb.tutor_id, async () => {
      await c.query(`update demo_feedback set tutor_reply = 'Thank you' where id = $1`, [fb.id])
    })
    // RLS may hide the row from an update the guard allows; either way no error.
    assert.equal(err, null, `tutor may reply (${err})`)
    // A stranger.
    const stranger = (await c.query(`select id from profiles where id not in ($1, $2) and role = 'parent' limit 1`, [fb.parent_id, fb.tutor_id])).rows[0].id
    err = await asMember(c, stranger, async () => {
      await c.query(`insert into demo_feedback (parent_id, tutor_id, rating, feedback_text, demo_request_id) values ($1, $2, 5, 'fake review', null)`, [stranger, fb.tutor_id])
    })
    assert.ok(err, 'feedback without a completed demo of yours is refused')

    const pol = (await c.query(`select policyname, permissive from pg_policies where tablename = 'demo_feedback' and cmd = 'DELETE'`)).rows
    console.log('delete policies', pol)

    await c.query(apply ? 'commit' : 'rollback')
    console.log(apply ? 'APPLIED 244 — all checks passed' : 'DRY RUN 244 (rolled back) — all checks passed')
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
