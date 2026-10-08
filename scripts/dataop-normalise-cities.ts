/**
 * scripts/dataop-normalise-cities.ts (owner, 8 Oct 2026)
 *
 * Fix stored city spellings ("lahore", "LAHORE", " Lahore ") to the canonical
 * name, through public.canon_city() — the same function the save-time trigger
 * (migration 154) uses, so data and new writes agree. Only rows whose value
 * actually changes are touched.
 *
 *   npx tsx --env-file=.env.local scripts/dataop-normalise-cities.ts          # SELECT only
 *   npx tsx --env-file=.env.local scripts/dataop-normalise-cities.ts --apply  # update, then re-SELECT
 */
// @ts-expect-error pg ships no bundled types; dev-only data-op script.
import pg from 'pg'

const APPLY = process.argv.includes('--apply')
const TABLES = ['jobs', 'profiles', 'tutor_profiles', 'tutor_areas']

async function report(c: pg.Client) {
  const rows: { table: string; stored: string; canonical: string; n: number }[] = []
  for (const t of TABLES) {
    const r = await c.query(
      `select city as stored, public.canon_city(city) as canonical, count(*)::int n from public."${t}"
        where city is not null and city is distinct from public.canon_city(city) group by 1, 2 order by 3 desc`,
    )
    for (const x of r.rows) rows.push({ table: t, ...x })
  }
  return rows
}

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const before = await report(c)
    console.log('BEFORE — rows whose city is not the canonical spelling:'); console.table(before)
    if (!APPLY) { console.log('Dry run only. Re-run with --apply.'); return }
    await c.query('begin')
    let total = 0
    for (const t of TABLES) {
      const r = await c.query(`update public."${t}" set city = public.canon_city(city) where city is not null and city is distinct from public.canon_city(city)`)
      console.log(`${t}: ${r.rowCount} row(s) changed`)
      total += r.rowCount ?? 0
    }
    await c.query('commit')
    console.log(`TOTAL changed: ${total}`)
    console.log('AFTER:'); console.table(await report(c))
  } finally {
    await c.end()
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
