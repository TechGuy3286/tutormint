/**
 * scripts/apply-migration-188.ts — applies supabase/migrations/188_all_pk_cities.sql.
 * One transaction; without --apply it rolls back. Runs the file twice (it must
 * be re-runnable), then checks: the existing city rows (id, name, sort_order)
 * are byte-identical, every new name from the file is present exactly once, no
 * city name is duplicated case-insensitively, and no jobs / profiles /
 * tutor_profiles / tutor_areas row changed. Prints counts only.
 *   npx tsx --env-file=.env.local scripts/apply-migration-188.ts [--apply]
 */
import { readFileSync } from 'node:fs'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const apply = process.argv.includes('--apply')
  const sql = readFileSync('supabase/migrations/188_all_pk_cities.sql', 'utf8')
  const block = sql.split('insert into public.location_cities')[1].split('on conflict')[0]
  const names = [...block.matchAll(/\('((?:[^']|'')+)', 100\)/g)].map((m) => m[1].replace(/''/g, "'"))
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  await c.query('begin')
  try {
    const cityFp = `select count(*)::int n, md5(string_agg(id::text || '|' || name || '|' || sort_order::text, ',' order by id)) h from location_cities`
    const dataFp = `select
        (select md5(string_agg(id::text || coalesce(city,'') || coalesce(area,''), ',' order by id)) from jobs) j,
        (select md5(string_agg(id::text || coalesce(city,''), ',' order by id)) from profiles) p,
        (select md5(string_agg(id::text || coalesce(city,''), ',' order by id)) from tutor_profiles) t,
        (select count(*)::int from tutor_areas) ta,
        (select count(*)::int from taxonomy_aliases where kind = 'city') al`
    const before = (await c.query(cityFp)).rows[0]
    const dataBefore = (await c.query(dataFp)).rows[0]
    const existingRows = (await c.query(`select id, name, sort_order from location_cities order by id`)).rows
    await c.query(sql)
    await c.query(sql)
    const dataAfter = (await c.query(dataFp)).rows[0]
    for (const k of ['j', 'p', 't', 'ta'] as const) if (dataBefore[k] !== dataAfter[k]) throw new Error(`member data changed (${k})`)
    // The rows that were there are exactly as they were.
    const nowExisting = (await c.query(`select id, name, sort_order from location_cities where id = any($1::int[]) order by id`, [existingRows.map((r: { id: number }) => r.id)])).rows
    if (JSON.stringify(nowExisting) !== JSON.stringify(existingRows)) throw new Error('an existing city row changed')
    const after = (await c.query(cityFp)).rows[0]
    const dup = (await c.query(`select lower(name) n, count(*)::int k from location_cities group by 1 having count(*) > 1`)).rows
    if (dup.length) throw new Error(`duplicate city names: ${dup.length}`)
    const present = (await c.query(`select count(*)::int n from location_cities where name = any($1::text[])`, [names])).rows[0].n
    if (present !== names.length) throw new Error(`expected ${names.length} new names present, found ${present}`)
    const kasur = (await c.query(`select count(*)::int n from location_cities where name = 'Kasur'`)).rows[0].n
    console.log(`cities before ${before.n}, after ${after.n} (+${after.n - before.n}); file lists ${names.length} new; Kasur ${kasur}`)
    console.log(`existing ${existingRows.length} rows unchanged; member data unchanged; city aliases ${dataBefore.al} -> ${dataAfter.al}`)
    if (apply) {
      await c.query('commit')
      console.log('APPLIED')
    } else {
      await c.query('rollback')
      console.log('dry run — rolled back')
    }
  } catch (e) {
    await c.query('rollback')
    console.error('FAILED, rolled back:', (e as Error).message)
    process.exitCode = 1
  } finally {
    await c.end()
  }
}
void main()
