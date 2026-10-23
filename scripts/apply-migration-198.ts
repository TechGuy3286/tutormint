/**
 * scripts/apply-migration-198.ts — applies supabase/migrations/198_staff_cleanup_hidden_tuitions.sql.
 * One transaction; without --apply it rolls back. Runs the file twice
 * (idempotent) and checks:
 *   - no tuition of a visible parent changed status;
 *   - every tuition of a hidden / test / suspended / banned parent is now
 *     'hidden' with the status it had kept (listed by TM number);
 *   - un-hiding a parent restores each tuition (proved inside a savepoint that
 *     is rolled back), and hiding again hides them again;
 *   - a direct credit needs no staff id and a link credit still needs one;
 *   - the profiles CHECK admits 'supervisor';
 *   - hidden_tuition_redirects() runs as anon.
 * Prints TM numbers and counts only — never a phone, CNIC or email.
 *   npx tsx --env-file=.env.local scripts/apply-migration-198.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const HIDE = `(coalesce(p.is_banned,false) or coalesce(p.is_suspended,false) or coalesce(p.hidden_from_public,false) or coalesce(p.is_test_name,false))`

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/198_staff_cleanup_hidden_tuitions.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('begin')
  try {
    const visibleFp = `select md5(string_agg(j.id::text || coalesce(j.status,''), ',' order by j.id)) m
                         from jobs j join profiles p on p.id = j.parent_id where not ${HIDE}`
    const before = (await c.query(visibleFp)).rows[0].m
    const toHide = (
      await c.query(
        `select j.id, j.ref_id, j.status, p.full_name as parent from jobs j join profiles p on p.id = j.parent_id
          where ${HIDE} order by j.ref_id`,
      )
    ).rows
    await c.query(sql)
    await c.query(sql)
    const after = (await c.query(visibleFp)).rows[0].m
    if (before !== after) throw new Error('a tuition of a visible parent changed')
    console.log('visible parents: no tuition changed')

    const hidden = (await c.query(`select id, ref_id, status, hidden_prev_status, hidden_reason from jobs where status = 'hidden' order by ref_id`)).rows
    const byId = new Map(hidden.map((h: { id: string }) => [h.id, h]))
    for (const t of toHide) {
      const h = byId.get(t.id) as { hidden_prev_status: string } | undefined
      if (!h) throw new Error(`${t.ref_id} was not hidden`)
      if (h.hidden_prev_status !== (t.status ?? 'open')) throw new Error(`${t.ref_id} lost its status`)
    }
    if (hidden.length !== toHide.length) throw new Error(`hidden ${hidden.length}, expected ${toHide.length}`)
    console.log(`hidden tuitions: ${hidden.length}`)
    const byParent = new Map<string, string[]>()
    for (const t of toHide) byParent.set(t.parent, [...(byParent.get(t.parent) ?? []), `${t.ref_id} (${t.status})`])
    for (const [parent, refs] of byParent) console.log(`  ${parent}: ${refs.join(', ')}`)

    const apps = (
      await c.query(
        `select j.ref_id, count(*)::int n from applications a join jobs j on j.id = a.job_id
          where j.status = 'hidden' and a.status <> 'withdrawn' group by j.ref_id order by j.ref_id`,
      )
    ).rows
    console.log(`applications on hidden tuitions: ${apps.reduce((s: number, r: { n: number }) => s + r.n, 0)}`)
    for (const r of apps) console.log(`  ${r.ref_id}: ${r.n}`)

    // Restore proof, rolled back.
    if (toHide.length) {
      const parentId = (await c.query(`select parent_id from jobs where id = $1`, [toHide[0].id])).rows[0].parent_id
      const reason = (await c.query(`select hidden_reason from jobs where id = $1`, [toHide[0].id])).rows[0].hidden_reason
      await c.query('savepoint restore_proof')
      const flags = (await c.query(`select is_banned, is_suspended, hidden_from_public, full_name from profiles where id = $1`, [parentId])).rows[0]
      await c.query(`update profiles set is_banned = false, is_suspended = false, hidden_from_public = false,
                       full_name = regexp_replace(full_name, '\\mtest\\M', 'tst', 'gi') where id = $1`, [parentId])
      const back = (await c.query(`select ref_id, status from jobs where parent_id = $1 order by ref_id`, [parentId])).rows
      for (const b of back) {
        const was = toHide.find((t: { ref_id: string }) => t.ref_id === b.ref_id)
        if (b.status !== (was?.status ?? 'open')) throw new Error(`${b.ref_id} did not restore (${b.status})`)
      }
      console.log(`restore proof: ${back.length} tuition(s) of one ${reason} parent back to their own status on un-hide`)
      await c.query(`update profiles set is_banned = $2, is_suspended = $3, hidden_from_public = $4, full_name = $5 where id = $1`, [parentId, flags.is_banned, flags.is_suspended, flags.hidden_from_public, flags.full_name])
      const again = (await c.query(`select count(*)::int n from jobs where parent_id = $1 and status <> 'hidden'`, [parentId])).rows[0].n
      if (again !== 0) throw new Error('hiding again did not hide every tuition')
      console.log('restore proof: hiding again hides them again')
      await c.query('rollback to savepoint restore_proof')
    }

    // Direct credit shape.
    await c.query('savepoint credit_proof')
    const member = (await c.query(`select id from profiles where role = 'tutor' and id not in (select member_id from staff_signup_credits) limit 1`)).rows[0]
    if (member) {
      await c.query(`insert into staff_signup_credits (member_id, staff_id, member_role, source) values ($1, null, 'tutor', 'direct')`, [member.id])
      let refused = false
      try {
        await c.query('savepoint inner_p')
        await c.query(`update staff_signup_credits set source = 'link' where member_id = $1`, [member.id])
      } catch {
        refused = true
        await c.query('rollback to savepoint inner_p')
      }
      if (!refused) throw new Error('a link credit with no staff id was accepted')
      console.log('credits: direct needs no staff id; a link credit still needs one')
    }
    await c.query('rollback to savepoint credit_proof')

    const chk = (await c.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'profiles_admin_role_check'`)).rows[0].d
    if (!String(chk).includes('supervisor')) throw new Error('supervisor not in the admin_role check')
    console.log('admin_role check admits supervisor')

    await c.query(`set local role anon`)
    const red = (await c.query(`select count(*)::int n from hidden_tuition_redirects()`)).rows[0].n
    await c.query(`reset role`)
    console.log(`hidden_tuition_redirects() as anon: ${red} row(s)`)

    if (apply) {
      await c.query('commit')
      console.log('APPLIED')
    } else {
      await c.query('rollback')
      console.log('dry run — rolled back')
    }
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    await c.end()
  }
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
