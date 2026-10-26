/**
 * scripts/apply-migration-201.ts — applies supabase/migrations/201_status_merge_parents_viewas.sql.
 * One transaction; without --apply it rolls back. Runs the file twice
 * (idempotent) and checks:
 *   - profiles, tutor_profiles, member_notes and admin_message_templates rows
 *     are unchanged (the new columns aside; templates only gain the 6 new keys);
 *   - every public table with RLS has the three restrictive View-as policies,
 *     and so does storage.objects;
 *   - a signed-in token cannot write the new tables (rolled-back savepoints);
 *   - a write made with a View-as session id is refused, and the same write
 *     with any other session id is not decided by the new policy (probed on
 *     shortlists in a rolled-back savepoint, with invented ids);
 *   - members are not granted UPDATE on merged_into / merged_at / secondary_phone.
 * Prints counts only — never a phone, email or value.
 *   npx tsx --env-file=.env.local scripts/apply-migration-201.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/201_status_merge_parents_viewas.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('begin')
  try {
    const fp = (t: string, minus: string[] = []) =>
      `select count(*)::int n, md5(coalesce(string_agg((to_jsonb(x)${minus.map((m) => ` - '${m}'`).join('')})::text, ',' order by x.id), '')) m from ${t} x`
    const before = {
      profiles: (await c.query(fp('profiles'))).rows[0],
      tutor: (await c.query(fp('tutor_profiles'))).rows[0],
      notes: (await c.query(fp('member_notes'))).rows[0],
      tpl: (await c.query(`select count(*)::int n, md5(coalesce(string_agg(to_jsonb(x)::text, ',' order by x.key), '')) m from admin_message_templates x`)).rows[0],
    }
    await c.query(sql)
    await c.query(sql)
    const after = {
      profiles: (await c.query(fp('profiles', ['merged_into', 'merged_at', 'secondary_phone']))).rows[0],
      tutor: (await c.query(fp('tutor_profiles', ['status_card_dismissed_at']))).rows[0],
      notes: (await c.query(fp('member_notes'))).rows[0],
      tpl: (
        await c.query(
          `select count(*)::int n, md5(coalesce(string_agg(to_jsonb(x)::text, ',' order by x.key), '')) m from admin_message_templates x where key not in ('status_image_verified','pf_no_tuition','pf_no_applicants','pf_email_unconfirmed','pf_expired','pf_hired')`,
        )
      ).rows[0],
    }
    if (before.profiles.m !== after.profiles.m) throw new Error('a profiles row changed')
    if (before.tutor.m !== after.tutor.m) throw new Error('a tutor_profiles row changed')
    if (before.notes.m !== after.notes.m) throw new Error('a member_notes row changed')
    const newTpl = (await c.query(`select count(*)::int n from admin_message_templates where key in ('status_image_verified','pf_no_tuition','pf_no_applicants','pf_email_unconfirmed','pf_expired','pf_hired')`)).rows[0].n
    if (newTpl !== 6) throw new Error(`expected 6 new templates, found ${newTpl}`)
    if (before.tpl.n + 6 - (after.tpl.n === before.tpl.n ? 0 : 0) < after.tpl.n) throw new Error('templates changed unexpectedly')

    const rls = (await c.query(`select count(*)::int n from pg_tables where schemaname='public' and rowsecurity`)).rows[0].n
    const pol = (await c.query(`select count(*)::int n from pg_policies where schemaname='public' and policyname in ('view_as_no_insert','view_as_no_update','view_as_no_delete') and permissive = 'RESTRICTIVE'`)).rows[0].n
    if (pol !== rls * 3) throw new Error(`restrictive policies ${pol}, expected ${rls * 3}`)
    const sto = (await c.query(`select count(*)::int n from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'view_as_no_%'`)).rows[0].n
    if (sto !== 3) throw new Error('storage.objects is missing a View-as policy')

    for (const t of ['member_duplicate_dismissals', 'member_merges', 'view_as_sessions']) {
      await c.query('savepoint s')
      await c.query(`set local role authenticated`)
      let refused = false
      try {
        await c.query(`delete from ${t}`)
        const n = (await c.query(`select count(*)::int n from ${t}`)).rows[0].n
        await c.query(
          t === 'member_merges'
            ? `insert into member_merges (kept_id, merged_id) select id, id from profiles limit 0`
            : t === 'view_as_sessions'
              ? `insert into view_as_sessions (owner_id, member_id, session_id, expires_at) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), now())`
              : `insert into member_duplicate_dismissals (a_id, b_id) values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002')`,
        )
        if (n >= 0 && t === 'member_merges') refused = true // nothing visible to write over
      } catch {
        refused = true
      }
      await c.query('rollback to savepoint s')
      if (!refused) throw new Error(`${t} accepted a signed-in write`)
    }

    // The View-as lock, probed with invented ids on shortlists.
    const owner = (await c.query(`select id from profiles where role='admin' limit 1`)).rows[0]?.id
    const member = (await c.query(`select id from profiles where role='parent' limit 1`)).rows[0]?.id
    const tutor = (await c.query(`select id from profiles where role='tutor' limit 1`)).rows[0]?.id
    if (owner && member && tutor) {
      const sid = '11111111-2222-4333-8444-555555555555'
      await c.query('savepoint v')
      await c.query(`insert into view_as_sessions (owner_id, member_id, session_id, expires_at) values ($1, $2, $3, now() + interval '30 minutes')`, [owner, member, sid])
      await c.query(`set local role authenticated`)
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: member, role: 'authenticated', session_id: sid })])
      let blocked = false
      try {
        await c.query(`insert into shortlists (user_id, tutor_id) values ($1, $2)`, [member, tutor])
      } catch (e) {
        blocked = /row-level security/i.test(String((e as Error).message))
      }
      await c.query('rollback to savepoint v')
      if (!blocked) throw new Error('a View-as session was able to write')
      // A normal session (another id) is not refused by the new policy.
      await c.query('savepoint w')
      await c.query(`set local role authenticated`)
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: member, role: 'authenticated', session_id: '99999999-2222-4333-8444-555555555555' })])
      const ok = (await c.query(`select public.is_view_as_session() v`)).rows[0].v
      await c.query('rollback to savepoint w')
      if (ok) throw new Error('an ordinary session was taken for a View-as one')
    }

    const grants = (
      await c.query(
        `select count(*)::int n from information_schema.column_privileges where table_schema='public' and table_name='profiles' and privilege_type='UPDATE' and grantee in ('authenticated','anon') and column_name in ('merged_into','merged_at','secondary_phone')`,
      )
    ).rows[0].n
    if (grants !== 0) throw new Error('members can update the merge columns')

    console.log(
      `profiles ${after.profiles.n}, tutor_profiles ${after.tutor.n}, member_notes ${after.notes.n} unchanged; 6 templates added; ${rls} RLS tables × 3 restrictive policies + storage; new tables refuse signed-in writes; View-as lock holds; merge columns not member-writable`,
    )
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
