/**
 * scripts/apply-migration-182.ts — applies
 * supabase/migrations/182_my_signups_location_run_review.sql. One transaction;
 * without --apply it rolls back. Runs the file twice (idempotent), checks no
 * sign-up / Locations data row changed, and PROVES the new policies: inside the
 * transaction, as each participant's own token, they see only their own
 * credits; as the Owner, every credit.
 *   npx tsx --env-file=.env.local scripts/apply-migration-182.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

type Row = Record<string, string>

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/182_my_signups_location_run_review.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const fp = async () =>
    (
      await c.query(
        `select (select md5(coalesce(string_agg(member_id::text || staff_id::text, ',' order by member_id), '')) from staff_signup_credits) credits,
                (select md5(coalesce(string_agg(id::text || status, ',' order by id), '')) from staff_signup_claims) claims,
                (select md5(coalesce(string_agg(id::text || name || coalesce(removed_at::text, ''), ',' order by id), '')) from location_areas) areas,
                (select md5(coalesce(string_agg(id::text || raw || area_id::text || coalesce(removed_at::text, ''), ',' order by id), '')) from location_area_aliases) aliases,
                (select md5(coalesce(string_agg(id::text || raw || coalesce(removed_at::text, ''), ',' order by id), '')) from location_ignored) ignored,
                (select md5(string_agg(key || body, '|' order by key)) from admin_message_templates where key not like 'my_signup_%') templates`,
      )
    ).rows[0] as Row
  const before = await fp()
  await c.query('begin')
  try {
    await c.query(sql)
    await c.query(sql)
    const after = await fp()
    for (const k of Object.keys(before)) {
      console.log(`${k} unchanged:`, before[k] === after[k])
      if (before[k] !== after[k]) throw new Error(`${k} changed`)
    }
    const staff = await c.query(
      `select p.id, p.full_name, p.admin_role, (select count(*)::int from staff_signup_credits s where s.staff_id = p.id) own
         from profiles p where p.role = 'admin' and p.admin_role is not null order by p.full_name`,
    )
    const total = (await c.query('select count(*)::int n from staff_signup_credits')).rows[0].n as number
    for (const s of staff.rows as { id: string; full_name: string; admin_role: string; own: number }[]) {
      await c.query('savepoint as_staff')
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: s.id, role: 'authenticated' })])
      await c.query('set local role authenticated')
      const seen = (await c.query('select count(*)::int n, count(*) filter (where staff_id <> $1)::int other from staff_signup_credits', [s.id])).rows[0]
      await c.query('rollback to savepoint as_staff')
      const all = ['owner', 'partner', 'admin'].includes(s.admin_role)
      const want = all ? total : s.own
      console.log(`${s.full_name} (${s.admin_role}): sees ${seen.n} (others' ${seen.other}); expected ${want}`)
      if (seen.n !== want || (!all && seen.other !== 0)) throw new Error(`policy wrong for ${s.full_name}`)
    }
    const tpl = await c.query(`select key from admin_message_templates where key like 'my_signup_%' order by key`)
    console.log('templates:', tpl.rows.map((r: Row) => r.key).join(', '))
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
  console.error(e)
  process.exit(1)
})
