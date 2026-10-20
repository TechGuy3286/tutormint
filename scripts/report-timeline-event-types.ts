/**
 * scripts/report-timeline-event-types.ts — READ-ONLY.
 * Every distinct event type that can reach the admin member timeline: the
 * member's own events (user_activity_log.event_type) and the admin actions
 * (admin_audit_log.action), with how many rows each has and the label the
 * timeline shows for it. Prints types and counts only — no names, numbers or
 * emails.
 *   npx tsx --env-file=.env.local scripts/report-timeline-event-types.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { auditSentence } from '../lib/memberTimelineCore'
import { timelineSentence } from '../lib/timelineText'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const ev = await c.query(`select event as t, count(*)::int as n from user_activity_log group by 1 order by 1`)
    const au = await c.query(`select action as t, count(*)::int as n from admin_audit_log group by 1 order by 1`)
    console.log(`MEMBER EVENTS (${ev.rows.length})`)
    for (const r of ev.rows) console.log(`  ${r.t}\t${r.n}\t${timelineSentence(r.t, {})}`)
    console.log(`ADMIN ACTIONS (${au.rows.length})`)
    for (const r of au.rows) console.log(`  ${r.t}\t${r.n}\t${auditSentence(r.t, null, 'Staff')}`)
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
