/**
 * scripts/report-consent-baseline.ts — read-only. Counts only, never a number,
 * email or name of a member (staff names are shown: they are the people the
 * consent counts are about).
 *
 *   npx tsx --env-file=.env.local scripts/report-consent-baseline.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  try {
    const q = async (label: string, sql: string) => {
      const r = await c.query(sql)
      console.log(`\n== ${label}`)
      console.table(r.rows)
    }
    await q('team account', `select full_name, is_team_account from profiles where is_team_account`)
    await q('jobs by poster kind', `
      select case when p.is_team_account then 'team' else 'parent' end kind, j.status, count(*)::int n
      from jobs j join profiles p on p.id = j.parent_id group by 1,2 order by 1,2`)
    await q('staff posters (tuition_owners.posted_by)', `
      select coalesce(sp.full_name,'(none)') staff, count(*)::int n
      from jobs j join profiles p on p.id=j.parent_id and p.is_team_account
      left join tuition_owners o on o.job_id=j.id left join profiles sp on sp.id=o.posted_by
      group by 1 order by 2 desc`)
    await q('reports by target', `select target_type, reason, status, count(*)::int n from reports group by 1,2,3 order by 4 desc`)
    await q('report targets that are the team account', `
      select count(*)::int n from reports r join profiles p on p.id=r.reported_id where p.is_team_account`)
    await q('open team tuitions with a job_contacts phone', `
      select count(*)::int n from jobs j join profiles p on p.id=j.parent_id and p.is_team_account
      join job_contacts jc on jc.job_id=j.id where j.status='open' and (jc.contact_phone is not null or jc.contact_whatsapp is not null)`)
    await q('reveals on team tuitions', `
      select (select count(*)::int from tuition_access ta join jobs j on j.id=ta.job_id join profiles p on p.id=j.parent_id and p.is_team_account) access_rows`)
    await q('addresses waiting by role', `select role, address_status, count(*)::int n from profiles where address is not null and btrim(address)<>'' group by 1,2 order by 1,2`)
    await q('existing settings like hide', `select key from app_settings where key ilike '%consent%' or key ilike '%hide%'`)
    await q('admin message templates count', `select count(*)::int n from admin_message_templates`)
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
