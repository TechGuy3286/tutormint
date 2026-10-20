/**
 * scripts/report-timeline-sizes.ts — READ-ONLY.
 * How big one member's merged admin timeline can get: the largest per-member
 * counts of user_activity_log rows, admin_audit_log rows naming them, activity
 * sessions and activity events. Counts only — no names, numbers or emails.
 *   npx tsx --env-file=.env.local scripts/report-timeline-sizes.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const q = async (label: string, sql: string) => {
    const { rows } = await c.query(sql)
    console.log(label, rows.map((r: { n: number }) => Number(r.n)).join(', '))
  }
  await q('user_activity_log, top 5 per member:', `select count(*) n from user_activity_log group by user_id order by 1 desc limit 5`)
  await q('admin_audit_log by target, top 5:', `select count(*) n from admin_audit_log where target_id is not null group by target_id order by 1 desc limit 5`)
  await q('activity_sessions, top 5 per member:', `select count(*) n from activity_sessions group by user_id order by 1 desc limit 5`)
  await q('activity_events, top 5 per member:', `select count(*) n from activity_events group by user_id order by 1 desc limit 5`)
  await q('activity_sessions last 90 days, top 5:', `select count(*) n from activity_sessions where started_at > now() - interval '90 days' group by user_id order by 1 desc limit 5`)
  await c.end()
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
