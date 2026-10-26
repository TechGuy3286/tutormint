/**
 * scripts/apply-migration-204.ts — applies supabase/migrations/204_reviews.sql.
 * One transaction; without --apply it rolls back.
 *
 * Checks (every probe write is inside a savepoint that is rolled back — no
 * review, stage or rating a member could see is ever stored):
 *   - reviews row count and every tutor's rating unchanged by the migration;
 *   - a parent whose application with a tutor is at Hired CAN insert a pending
 *     review; a second one for the same hire is refused; one inserted as
 *     approved is refused; another parent is refused; a not-hired application
 *     is refused;
 *   - a pending review is invisible to anon and does not count in the rating;
 *     once approved it is visible and counts (rating_count 1);
 *   - the pf_hired template carries {review_link}.
 * Prints counts only — never a name, phone, email or text.
 *
 *   npx tsx --env-file=.env.local scripts/apply-migration-204.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/204_reviews.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await c.connect()
  await c.query('begin')
  await c.query(`set local lock_timeout = '5s'`)
  try {
    const fp = async () =>
      (await c.query(`select (select count(*)::int from reviews) n, md5(coalesce(string_agg(id::text || ':' || coalesce(rating_avg,0) || ':' || coalesce(rating_count,0), ',' order by id), '')) m from tutor_profiles`)).rows[0]
    const before = await fp()
    await c.query(sql)
    await c.query(sql) // re-runnable
    const after = await fp()
    if (before.n !== after.n || before.m !== after.m) throw new Error('reviews or ratings changed')
    console.log('reviews rows unchanged:', after.n, '· every tutor rating unchanged')

    const app = (
      await c.query(`select a.id, a.tutor_id, j.parent_id from applications a join jobs j on j.id = a.job_id
                      where coalesce(a.status,'') <> 'withdrawn' and j.parent_id is not null and j.parent_id <> a.tutor_id
                      order by a.created_at limit 1`)
    ).rows[0] as { id: string; tutor_id: string; parent_id: string }
    const other = (await c.query(`select id from profiles where role = 'parent' and id <> $1 order by created_at limit 1`, [app.parent_id])).rows[0].id as string

    const as = async (who: string | null) => {
      if (who) {
        await c.query(`set local role authenticated`)
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who, role: 'authenticated', session_id: '00000000-0000-4000-8000-000000000000' })])
      } else {
        await c.query(`set local role anon`)
        await c.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`)
      }
    }
    const back = async () => {
      await c.query(`reset role`)
      await c.query(`select set_config('request.jwt.claims', '', true)`)
    }
    const insert = (who: string, status = 'pending') =>
      c.query(
        `insert into reviews (parent_id, tutor_id, application_id, rating, comment, reviewer_type, target_id, rating_primary, status)
         values ($1, $2, $3, 4, 'probe review text', 'parent', $2, 4, $4) returning id`,
        [who, app.tutor_id, app.id, status],
      )
    const refused = async (label: string, fn: () => Promise<unknown>) => {
      await c.query('savepoint r')
      try {
        await fn()
        throw new Error(`NOT refused: ${label}`)
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('NOT refused')) throw e
        console.log('refused as it should be:', label)
      }
      await c.query('rollback to savepoint r')
    }

    await c.query('savepoint probe')
    // Not hired yet: refused.
    await c.query(`update applications set stage = 'applied' where id = $1`, [app.id])
    await as(app.parent_id)
    await refused('a parent whose application is not at Hired', () => insert(app.parent_id))
    await back()
    // Hired: allowed once, pending only, own parent only.
    await c.query(`update applications set stage = 'hired' where id = $1`, [app.id])
    await as(other)
    await refused('another parent', () => insert(other))
    await back()
    await as(app.parent_id)
    await refused('a review inserted as approved', () => insert(app.parent_id, 'approved'))
    const created = (await insert(app.parent_id)).rows[0].id as string
    console.log('the hired parent CAN leave a pending review')
    await refused('a second review for the same hire', () => insert(app.parent_id))
    const ownSee = (await c.query(`select count(*)::int n from reviews where id = $1`, [created])).rows[0].n
    if (ownSee !== 1) throw new Error('the parent cannot see their own pending review')
    await refused('the parent approving their own review', async () => {
      const r = await c.query(`update reviews set status = 'approved' where id = $1`, [created])
      if (r.rowCount === 0) throw new Error('no row updated (no update policy)')
    })
    await back()
    await as(null)
    const anonPending = (await c.query(`select count(*)::int n from reviews where id = $1`, [created])).rows[0].n
    await back()
    const pendingCount = (await c.query(`select rating_count from tutor_profiles where id = $1`, [app.tutor_id])).rows[0]?.rating_count
    if (anonPending !== 0) throw new Error('a pending review is visible to the public')
    console.log('pending: hidden from the public · rating_count =', pendingCount)
    await c.query(`update reviews set status = 'approved', decided_at = now() where id = $1`, [created])
    await as(null)
    const anonApproved = (await c.query(`select count(*)::int n from reviews where id = $1`, [created])).rows[0].n
    await back()
    const approvedCount = (await c.query(`select rating_count from tutor_profiles where id = $1`, [app.tutor_id])).rows[0]?.rating_count
    if (anonApproved !== 1) throw new Error('an approved review is not public')
    if (Number(approvedCount) !== Number(pendingCount ?? 0) + 1) throw new Error('the approved review did not count')
    console.log('approved: public · rating_count =', approvedCount)
    await c.query('rollback to savepoint probe')
    const end = await fp()
    if (end.n !== before.n || end.m !== before.m) throw new Error('probe left something behind')

    const tpl = (await c.query(`select count(*)::int n from admin_message_templates where key = 'pf_hired' and body like '%{review_link}%'`)).rows[0].n
    console.log('pf_hired with {review_link}:', tpl)

    if (apply) {
      await c.query('commit')
      console.log('APPLIED migration 204')
    } else {
      await c.query('rollback')
      console.log('dry run — rolled back')
    }
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
