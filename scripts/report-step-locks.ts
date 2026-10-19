/**
 * scripts/report-step-locks.ts — read-only. Which profile steps are locked, and
 * for how many tutors (owner, 19 Oct 2026). Prints counts only — no name,
 * phone, email or CNIC.
 *   - every live trigger + function that raises the field-lock error (TMLCK)
 *   - tutors whose Settings showed "Subjects you teach" / "Where you teach" as
 *     Locked (the Step-1-complete rule, public.tutor_step1_complete)
 *   - for those tutors: their profile-photo status
 *   npx tsx --env-file=.env.local scripts/report-step-locks.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await c.connect()
  try {
    const fns = await c.query(
      `select p.proname, pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f' and p.prosrc ilike '%TMLCK%' order by 1`,
    )
    console.log('Functions raising the field lock:')
    for (const f of fns.rows) {
      const checks = String(f.d)
        .split('\n')
        .filter((l: string) => /IS DISTINCT FROM|tutor_step1_complete|tm_photo_change_refused/i.test(l))
        .map((l: string) => '    ' + l.trim())
      console.log(`  ${f.proname}\n${checks.join('\n')}`)
    }
    const trg = await c.query(
      `select t.tgname, t.tgrelid::regclass::text tbl, p.proname from pg_trigger t join pg_proc p on p.oid = t.tgfoid
        where not t.tgisinternal and p.proname in (${fns.rows.map((_: unknown, i: number) => `$${i + 1}`).join(',') || "''"}) order by 2, 1`,
      fns.rows.map((f: { proname: string }) => f.proname),
    )
    console.log('Triggers:')
    for (const t of trg.rows) console.log(`  ${t.tbl}.${t.tgname} -> ${t.proname}`)

    const step1 = await c.query(
      `select count(*)::int n,
              count(*) filter (where lower(coalesce(p.profile_pic_status,'')) = 'approved')::int photo_approved,
              count(*) filter (where p.profile_pic_rereview_at is not null)::int photo_rereview
         from profiles p where p.role = 'tutor' and public.tutor_step1_complete(p.id)`,
    )
    const tutors = (await c.query(`select count(*)::int n from profiles where role = 'tutor'`)).rows[0].n
    const r = step1.rows[0]
    console.log(`Tutors: ${tutors}`)
    console.log(`Tutors with Step 1 complete (Settings showed Subjects + Where you teach as Locked; city and areas refused by the database): ${r.n}`)
    console.log(`  of them, profile photo approved: ${r.photo_approved}; changed photo waiting for review: ${r.photo_rereview}`)
    const mobile = (await c.query(`select count(*)::int n from profiles where role = 'tutor' and phone_verified_at is not null`)).rows[0].n
    console.log(`Tutors with a verified mobile (mobile card showed Locked): ${mobile}`)
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
