/**
 * scripts/dataop-removed-staff-revoke.ts — owner-approved (11 Nov 2026).
 * For the Backend Support member removed from the team on 10 Nov 2026: report
 * whether a live session remained, revoke every session and refresh token, and
 * hand any tuitions or cities still in her name to the Owner. One audit row
 * (staff.revoke_sessions, actor = the Owner). Counts only — never a name,
 * email or phone. Dry run unless --apply.
 *   npx tsx --env-file=.env.local scripts/dataop-removed-staff-revoke.ts [--apply]
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  try {
    const targets = (await c.query(`
      select id from profiles
       where former_staff_at >= '2026-11-09' and former_staff_at < '2026-11-12'
         and coalesce(former_staff_role, '') = 'backend_support'`)).rows
    if (targets.length !== 1) throw new Error(`expected exactly 1 removed Backend Support account, found ${targets.length}`)
    const id = targets[0].id as string
    const owner = (await c.query(`select id, email from profiles where role = 'admin' and admin_role = 'owner'`)).rows[0]
    const sess = (await c.query(`select count(*)::int n from auth.sessions where user_id = $1`, [id])).rows[0].n
    const tok = (await c.query(`select count(*) filter (where not revoked)::int n from auth.refresh_tokens where user_id = $1::text`, [id])).rows[0].n
    console.log(`live sessions before: ${sess}; live refresh tokens before: ${tok}`)
    await c.query(`select public.revoke_user_sessions($1::uuid)`, [id])
    const now = new Date().toISOString()
    const jobs = (await c.query(`update tuition_owners set staff_id = $2, source = 'reassigned', assigned_by = $2, assigned_by_name = 'Alee Sabeer', assigned_at = $3 where staff_id = $1 returning job_id`, [id, owner.id, now])).rows
    const cities = (await c.query(`update city_owners set staff_id = null, updated_by = $2, updated_by_name = 'Alee Sabeer', updated_at = $3 where staff_id = $1 returning city`, [id, owner.id, now])).rows
    const links = (await c.query(`update staff_join_links set deactivated_at = $2 where staff_id = $1 and deactivated_at is null returning staff_id`, [id, now])).rows
    await c.query(
      `insert into admin_audit_log (actor_id, actor_role, actor_email, action, target_type, target_id, detail)
       values ($1, 'owner', $2, 'staff.revoke_sessions', 'profile', $3, $4)`,
      [owner.id, owner.email, id, JSON.stringify({ reason: 'removed from team 10 Nov 2026 — clean exit (owner-approved data step)', sessionsBefore: sess, refreshTokensBefore: tok, tuitionsMoved: jobs.length, citiesReleased: cities.length, linksDeactivated: links.length })],
    )
    const after = (await c.query(`select count(*)::int n from auth.sessions where user_id = $1`, [id])).rows[0].n
    console.log(`sessions after: ${after}; tuitions moved to the Owner: ${jobs.length}; cities released: ${cities.length}; links switched off: ${links.length}`)
    await c.query(apply ? 'commit' : 'rollback')
    console.log(apply ? 'APPLIED' : 'dry run — rolled back')
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
