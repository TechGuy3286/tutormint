/**
 * scripts/report-email-usage-day.ts — READ ONLY. What used the email quota on
 * one UTC day (owner, 27 Oct 2026): counts by type and status from our own log
 * (email_sends), plus the skipped reasons with addresses removed. Never prints
 * an address.
 *
 *   npx tsx --env-file=.env.local scripts/report-email-usage-day.ts [YYYY-MM-DD]
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { cleanReason } from '../lib/email/usageCore'

async function main() {
  const day = process.argv[2] ?? '2026-10-27'
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  try {
    const q = await c.query(
      `select coalesce(template, job) t, status, count(*)::int n
         from email_sends
        where created_at >= $1::date and created_at < ($1::date + 1)
        group by 1, 2 order by 3 desc`,
      [day],
    )
    let sent = 0
    for (const r of q.rows) {
      console.log(`${r.t} · ${r.status} · ${r.n}`)
      if (r.status === 'sent') sent += r.n
    }
    console.log(`TOTAL sent on ${day} (UTC): ${sent}`)
    const reasons = await c.query(
      `select coalesce(template, job) t, error, count(*)::int n from email_sends
        where created_at >= $1::date and created_at < ($1::date + 1) and status <> 'sent'
        group by 1, 2 order by 3 desc limit 20`,
      [day],
    )
    for (const r of reasons.rows) console.log(`not sent: ${r.t} · ${cleanReason(r.error)} · ${r.n}`)
    const pk = await c.query(
      `select count(*)::int n from email_sends where status = 'sent'
         and created_at >= ($1::date - interval '5 hours') and created_at < ($1::date + interval '19 hours')`,
      [day],
    )
    console.log(`sent on ${day} (Pakistan time day): ${pk.rows[0].n}`)
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
