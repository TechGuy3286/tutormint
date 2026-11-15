/**
 * scripts/report-followup-chips.ts — READ ONLY. The People → Tutors chip counts
 * (owner, 15 Nov 2026), exactly as the page asks admin_list_page for them: the
 * real-account view, Not interested left out. Per followed-up stage: Not
 * followed up (due now), 1st, 2nd, 3rd+; and the Re-uploaded chip. Counts only —
 * never a name, phone or id. Also says when the stored list was last built and
 * whether its rows already carry the new tags.
 *   npx tsx --env-file=.env.local scripts/report-followup-chips.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  try {
    await c.query('begin read only')
    const built = (await c.query(`select payload->>'builtAt' b from admin_summary where key = 'state'`)).rows[0]?.b ?? null
    const tagged = (await c.query(`select count(*) filter (where tags ? 'fus')::int n, count(*)::int t from admin_list_rows where list = 'people:tutor'`)).rows[0]
    console.log(`summary built: ${built}`)
    console.log(`rows with the new tags: ${tagged.n} of ${tagged.t}`)
    const fixed = JSON.stringify({ excluded: false, ni: false })
    const page = async (rows: { param: string; value: string }[]) =>
      (await c.query(`select admin_list_page('people:tutor', $1::jsonb, null, null, '', '', $2::jsonb, null, null, 'pos', 0, 1) r`, [fixed, JSON.stringify(rows)])).rows[0].r as {
        rowCounts: Record<string, Record<string, number>>
        total: number
      }
    for (const stage of ['missing', 'rejected', 'approved']) {
      const r = await page([
        { param: 'stages', value: stage },
        { param: 'fus', value: 'not' },
      ])
      const fu = r.rowCounts.fus ?? {}
      console.log(`${stage}: Not followed up ${fu.not ?? 0} · 1st ${fu.f1 ?? 0} · 2nd ${fu.f2 ?? 0} · 3rd+ ${fu.f3 ?? 0}`)
    }
    const all = await page([{ param: 'stages', value: 'all' }])
    console.log(`Re-uploaded: ${all.rowCounts.stages?.reuploaded ?? 0}`)
    await c.query('rollback')
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
