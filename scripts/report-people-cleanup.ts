/**
 * scripts/report-people-cleanup.ts — READ-ONLY. The People page numbers after
 * the 9 Nov 2026 clean-up, from the stored admin summary: tutors per stage
 * (People's default view), the People badge parts, Applications' new count,
 * "Blank photos to check" and when the summary was built. Counts only — never
 * a name, number or contact.
 *   npx tsx --env-file=.env.local scripts/report-people-cleanup.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  try {
    await c.query('begin read only')
    const state = await c.query(`select payload->>'builtAt' b from admin_summary where key = 'state'`)
    console.log('summary built at:', state.rows[0]?.b ?? '—')
    const stages = await c.query(`
      select tags->>'stage' stage, count(*)::int n,
             count(*) filter (where tags->>'fu' = 'not')::int not_followed
        from admin_list_rows
       where list = 'people:tutor'
         and coalesce((tags->>'excluded')::boolean, false) = false
         and coalesce((tags->>'deleted')::boolean, false) = false
         and coalesce((tags->>'ni')::boolean, false) = false
       group by 1 order by 1`)
    for (const r of stages.rows) console.log(`stage ${r.stage}: ${r.n} (not followed up ${r.not_followed})`)
    const why = await c.query(`
      select tags->>'stage' stage,
        count(*) filter (where jsonb_array_length(coalesce(row->'pipe'->'pending','[]'::jsonb)) > 0)::int with_pending,
        count(*) filter (where jsonb_array_length(coalesce(row->'pipe'->'pending','[]'::jsonb)) > 0 and jsonb_array_length(row->'pipe'->'missing') = 0)::int all_in_pending,
        count(*) filter (where (row->'pipe'->>'noMobile')::boolean)::int no_mobile
        from admin_list_rows
       where list = 'people:tutor' and coalesce((tags->>'excluded')::boolean, false) = false and coalesce((tags->>'deleted')::boolean, false) = false
       group by 1 order by 1`)
    for (const r of why.rows) console.log(`  ${r.stage}: with a pending document ${r.with_pending} · all three in + pending ${r.all_in_pending} · no mobile ${r.no_mobile}`)
    const pending = await c.query(`select count(*)::int n from admin_list_rows where list = 'people:tutor' and row->'pipe' ? 'pending'`)
    console.log('rows built with the new card fields:', pending.rows[0].n)
    const b = await c.query(`select payload from admin_summary where key = 'badges'`)
    const p = (b.rows[0]?.payload ?? {}) as Record<string, unknown>
    console.log('badge parts — documents waiting:', p.peopleWaiting, '· fee pending not followed up:', p.pipelineDue, '· People badge (Owner):', Number(p.peopleWaiting ?? 0) + Number(p.pipelineDue ?? 0))
    console.log('applications new & unseen (all):', (p.appsNew as { total?: number } | undefined)?.total ?? 'not built yet')
    const ov = await c.query(`select payload->'todo-blank-photos'->>'count' blank, payload->'todo-docs'->>'count' docs from admin_summary where key = 'overview:7'`)
    console.log('Overview — Documents to approve:', ov.rows[0]?.docs, '· Blank photos to check:', ov.rows[0]?.blank ?? 'not built yet')
    const t = await c.query(`select to_regclass('public.photo_blank_checks') is not null e`)
    console.log('photo_blank_checks table exists:', t.rows[0].e)
    await c.query('rollback')
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
