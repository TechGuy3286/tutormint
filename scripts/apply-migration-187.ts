/**
 * scripts/apply-migration-187.ts — applies supabase/migrations/187_unlock_city_areas.sql.
 * One transaction; without --apply it rolls back. Runs the file twice
 * (idempotent), checks no profile/area row changed, then — inside a savepoint
 * that is always rolled back — acts as a real tutor whose Step 1 is complete
 * (CNIC, photo and selfie approved) and proves:
 *   editable: city, areas (add + remove), subjects (add + remove), headline, fee;
 *   still locked: the CNIC number, the profile photo (no unlock).
 * Prints outcomes only — never an id, name, phone or CNIC.
 *   npx tsx --env-file=.env.local scripts/apply-migration-187.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/187_unlock_city_areas.sql', 'utf8')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  try {
    const fp = `select (select md5(string_agg(id::text || coalesce(city,'') || coalesce(avatar_url,'') || coalesce(cnic_number,''), ',' order by id)) from profiles) p,
                       (select count(*)::int from tutor_areas) a, (select count(*)::int from tutor_subjects) s`
    const before = (await c.query(fp)).rows[0]
    await c.query(sql)
    await c.query(sql)
    const after = (await c.query(fp)).rows[0]
    if (before.p !== after.p || before.a !== after.a || before.s !== after.s) throw new Error('a row changed')
    console.log(`rows unchanged (tutor_areas ${after.a}, tutor_subjects ${after.s})`)

    const t = (
      await c.query(
        `select p.id from profiles p where p.role = 'tutor' and public.tutor_step1_complete(p.id)
            and coalesce(btrim(p.cnic_number),'') <> '' and p.admin_role is null limit 1`,
      )
    ).rows[0]?.id as string | undefined
    if (!t) throw new Error('no Step-1-complete tutor to test with')
    const extra = (
      await c.query(`select m.id from taxonomy_master m where not exists (select 1 from tutor_subjects s where s.tutor_id = $1 and s.master_id = m.id) limit 1`, [t])
    ).rows[0].id as number
    const anySubject = (await c.query(`select master_id from tutor_subjects where tutor_id = $1 limit 1`, [t])).rows[0].master_id as number
    const anyArea = (await c.query(`select id from tutor_areas where tutor_id = $1 limit 1`, [t])).rows[0]?.id as string | undefined

    await c.query('savepoint probe')
    await c.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: t, role: 'authenticated' }), t])
    await c.query('set local role authenticated')
    const attempt = async (label: string, q: string, params: unknown[]) => {
      await c.query('savepoint a')
      try {
        await c.query(q, params)
        await c.query('release savepoint a')
        return `${label}: saved`
      } catch (e) {
        await c.query('rollback to savepoint a')
        const code = (e as { code?: string }).code
        return `${label}: ${code === 'TMLCK' ? 'refused (locked)' : 'error ' + (e as Error).message}`
      }
    }
    const out = [
      await attempt('city', `update tutor_profiles set city = city || ' ' where id = $1`, [t]),
      await attempt('profiles.city', `update profiles set city = coalesce(city,'') || ' ' where id = $1`, [t]),
      await attempt('area add', `insert into tutor_areas (tutor_id, city, area) values ($1, 'Lahore', 'Probe Area 187')`, [t]),
      anyArea ? await attempt('area remove', `delete from tutor_areas where id = $1`, [anyArea]) : 'area remove: (no area)',
      await attempt('subject add', `insert into tutor_subjects (tutor_id, master_id) values ($1, $2)`, [t, extra]),
      await attempt('subject remove', `delete from tutor_subjects where tutor_id = $1 and master_id = $2`, [t, anySubject]),
      await attempt('headline', `update tutor_profiles set headline = coalesce(headline,'') || ' ' where id = $1`, [t]),
      await attempt('fee', `update tutor_profiles set fee_min_pkr = coalesce(fee_min_pkr, 0) where id = $1`, [t]),
      await attempt('cnic number', `update profiles set cnic_number = '00000-0000000-0' where id = $1`, [t]),
      await attempt('photo', `update tutor_profiles set avatar_url = 'https://example.invalid/probe.jpg' where id = $1`, [t]),
    ]
    await c.query('reset role')
    await c.query('rollback to savepoint probe')
    console.log(out.join('\n'))
    const want: Record<string, string> = {
      city: 'saved', 'profiles.city': 'saved', 'area add': 'saved', 'area remove': 'saved', 'subject add': 'saved',
      'subject remove': 'saved', headline: 'saved', fee: 'saved', 'cnic number': 'refused (locked)', photo: 'refused (locked)',
    }
    for (const line of out) {
      const [label, got] = line.split(': ')
      if (want[label] && want[label] !== got && !got.startsWith('(')) throw new Error(`unexpected: ${line}`)
    }
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
