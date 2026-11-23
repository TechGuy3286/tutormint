/**
 * scripts/explain-rank-tutors.ts — READ-ONLY timings for rank_tutors() (PR-17 Part A).
 * Runs inside a READ ONLY transaction that is always rolled back. Prints only
 * timings, row counts and plan lines — never a name, phone or email.
 *   npx tsx --env-file=.env.local scripts/explain-rank-tutors.ts [--plan] [--runs=N]
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const CASES: Array<{ name: string; args: string }> = [
  { name: 'browse (no filter)', args: `p_limit => 24` },
  { name: 'city lahore', args: `p_city => 'Lahore', p_limit => 24` },
  { name: 'lahore + subject masters', args: `p_city => 'Lahore', p_master_ids => (select array_agg(id) from taxonomy_master where subject_slug = 'english'), p_limit => 24` },
  { name: 'lahore + subject math', args: `p_city => 'Lahore', p_master_ids => (select array_agg(id) from taxonomy_master where subject_slug in ('math','mathematics')), p_limit => 24` },
  { name: 'name query', args: `p_query => 'ali', p_limit => 24` },
  { name: 'page 2 offset', args: `p_limit => 24, p_offset => 24` },
]

async function main() {
  const plan = process.argv.includes('--plan')
  const runs = Number(process.argv.find((a) => a.startsWith('--runs='))?.split('=')[1] ?? 5)
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await c.connect()
  try {
    await c.query('begin read only')
    const counts = (await c.query(`select (select count(*) from tutor_profiles) tp, (select count(*) from profiles) p, (select count(*) from tutor_subjects) ts, (select count(*) from tutor_areas) ta, (select count(*) from subscriptions) s, (select count(*) from tutor_directory) dir`)).rows[0]
    console.log('volumes', counts)
    for (const k of CASES) {
      const times: number[] = []
      let n = 0
      for (let i = 0; i < runs; i++) {
        const t0 = performance.now()
        const r = await c.query(`select count(*) n from rank_tutors(${k.args})`)
        times.push(performance.now() - t0)
        n = Number(r.rows[0].n)
      }
      times.sort((a, b) => a - b)
      console.log(`${k.name.padEnd(28)} rows=${n} min=${times[0].toFixed(0)}ms median=${times[Math.floor(times.length / 2)].toFixed(0)}ms max=${times[times.length - 1].toFixed(0)}ms`)
    }
    if (plan) {
      await c.query(`load 'auto_explain'`).catch(() => console.log('(auto_explain not loadable)'))
    }
    await c.query('rollback')
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
