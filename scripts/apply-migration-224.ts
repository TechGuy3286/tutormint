/**
 * scripts/apply-migration-224.ts — applies supabase/migrations/224_staff_docs_job_types_two_names.sql.
 * One transaction; without --apply it rolls back. Every behaviour check runs in
 * a savepoint that is rolled back, so nothing it tries is kept even with --apply.
 * Prints counts only — never a name, number or contact.
 *   npx tsx --env-file=.env.local scripts/apply-migration-224.ts [--apply]
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
  const sql = readFileSync('supabase/migrations/224_staff_docs_job_types_two_names.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 120000 })
  await c.connect()
  await c.query('begin')
  try {
    const before = await c.query(`select md5(string_agg(id::text || ':' || coalesce(full_name, '∅'), ',' order by id)) h, count(*)::int n from profiles`)
    const tpBefore = await c.query(`select md5(string_agg(id::text || ':' || coalesce(full_name, '∅') || ':' || coalesce(slug, ''), ',' order by id)) h from tutor_profiles`)
    // Both columns are new, so every profile with a name is backfilled.
    const hadCols = await c.query(`select count(*)::int n from information_schema.columns where table_schema='public' and table_name='profiles' and column_name in ('cnic_name','display_name')`)
    const toFill = hadCols.rows[0].n === 0
      ? await c.query(`select count(*)::int n, count(*) filter (where role in ('tutor','parent'))::int m from profiles where full_name is not null`)
      : await c.query(`select count(*)::int n, count(*) filter (where role in ('tutor','parent'))::int m from profiles where cnic_name is null or display_name is null`)

    await c.query(sql)
    await c.query(sql) // re-runnable

    const after = await c.query(`select md5(string_agg(id::text || ':' || coalesce(full_name, '∅'), ',' order by id)) h, count(*)::int n from profiles`)
    assert.equal(after.rows[0].h, before.rows[0].h, 'a shown name changed')
    const tpAfter = await c.query(`select md5(string_agg(id::text || ':' || coalesce(full_name, '∅') || ':' || coalesce(slug, ''), ',' order by id)) h from tutor_profiles`)
    assert.equal(tpAfter.rows[0].h, tpBefore.rows[0].h, 'a tutor profile name or address changed')
    const missing = await c.query(`select count(*)::int n from profiles where full_name is not null and (cnic_name is null or display_name is null)`)
    assert.equal(missing.rows[0].n, 0)
    const members = await c.query(`select count(*)::int n from profiles where role in ('tutor','parent')`)
    console.log(`backfilled: ${toFill.rows[0].n ?? after.rows[0].n} profiles (${toFill.rows[0].m ?? members.rows[0].n} tutors and parents); shown names unchanged`)
    const titles = await c.query(`select count(*)::int n from job_titles where name in ('Montessori Expert','Intermediate Teacher (FA / FSc / ICS / I.Com)','Graduation Level Teacher (BA / BSc / BS)')`)
    assert.equal(titles.rows[0].n, 3)

    // Behaviour, as a real member token, each rolled back.
    const approved = await c.query(`select id from profiles where role = 'tutor' and cnic_verified_at is not null and coalesce(is_suspended,false) = false limit 1`)
    const tid = approved.rows[0]?.id as string | undefined
    if (tid) {
      const e1 = await asMember(c, tid, async () => { await c.query(`update profiles set cnic_name = cnic_name || ' X' where id = $1`, [tid]) })
      assert.match(String(e1), /Name on CNIC/, 'approved CNIC name must be locked')
      let mirrored = false
      const e2 = await asMember(c, tid, async () => {
        await c.query(`update profiles set display_name = 'Zz Example Name' where id = $1`, [tid])
        const r = await c.query(`select p.full_name pf, tp.full_name tf, p.name_rereview_at from profiles p left join tutor_profiles tp on tp.id = p.id where p.id = $1`, [tid])
        assert.equal(r.rows[0].pf, 'Zz Example Name')
        mirrored = r.rows[0].tf === 'Zz Example Name'
        assert.equal(r.rows[0].name_rereview_at === null || r.rows[0].name_rereview_at !== undefined, true)
      })
      assert.equal(e2, null, String(e2))
      assert.ok(mirrored, 'tutor_profiles.full_name did not follow')
      const e3 = await asMember(c, tid, async () => { await c.query(`update profiles set display_name = 'TutorMint Official' where id = $1`, [tid]) })
      assert.match(String(e3), /TutorMint/)
      const e4 = await asMember(c, tid, async () => {
        await c.query(`update profiles set display_name = '' where id = $1`, [tid])
        const r = await c.query(`select full_name, cnic_name from profiles where id = $1`, [tid])
        assert.equal(r.rows[0].full_name, r.rows[0].cnic_name)
      })
      assert.equal(e4, null, String(e4))
      const e5 = await asMember(c, tid, async () => {
        await c.query(`update profiles set full_name = 'Legacy Writer Name' where id = $1`, [tid])
        const r = await c.query(`select full_name, display_name, cnic_name from profiles where id = $1`, [tid])
        assert.equal(r.rows[0].display_name, 'Legacy Writer Name')
        assert.notEqual(r.rows[0].cnic_name, 'Legacy Writer Name')
      })
      assert.equal(e5, null, String(e5))
      console.log('member checks: CNIC name locked after approval, Display name saved and mirrored, TutorMint refused, empty falls back, old writers set the Display name')
    }
    const unapproved = await c.query(`select id from profiles where role = 'tutor' and cnic_verified_at is null and coalesce(lower(verification_state),'') <> 'approved' limit 1`)
    const uid = unapproved.rows[0]?.id as string | undefined
    if (uid) {
      const e = await asMember(c, uid, async () => { await c.query(`update profiles set cnic_name = 'Zz Legal Name' where id = $1`, [uid]) })
      assert.equal(e, null, String(e))
      console.log('member check: CNIC name editable before approval')
    }
    const anon = await c.query(`select has_table_privilege('anon', 'public.staff_document_decisions', 'select') s`)
    assert.equal(anon.rows[0].s, false)

    await c.query(apply ? 'commit' : 'rollback')
    console.log(apply ? 'COMMITTED' : 'ROLLED BACK (dry run)')
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
