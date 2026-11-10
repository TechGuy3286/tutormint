/**
 * scripts/report-paid-signups.ts — READ ONLY (owner, 9 Nov 2026).
 * Prints the paid sign-up counts per period and the "Paid, not welcomed"
 * count exactly as the live admin shows them: read from the stored summary the
 * production job writes (admin_summary 'paidsignups' and 'overview:7').
 * Counts only — never a name, phone or amount.
 *   npx tsx --env-file=.env.local scripts/report-paid-signups.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { periodCounts, targetPace, type PaidSignupsPayload } from '../lib/paidSignupsCore'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  try {
    await c.query('begin read only')
    const { rows } = await c.query(`select key, payload, computed_at from admin_summary where key in ('paidsignups', 'overview:7', 'state')`)
    const by = new Map(rows.map((r: Record<string, unknown>) => [r.key as string, r]))
    const ps = by.get('paidsignups') as { payload: PaidSignupsPayload; computed_at: string } | undefined
    const state = by.get('state') as { payload: { builtAt?: string; failed?: string[] } } | undefined
    console.log('summary built at:', state?.payload.builtAt ?? 'unknown', '· failed parts:', (state?.payload.failed ?? []).join('; ') || 'none')
    if (!ps) {
      console.log('paidsignups: not written yet')
    } else {
      const now = Date.now()
      for (const p of periodCounts(ps.payload.rows, now)) {
        console.log(`${p.label}: ${p.count}${p.change ? ` (${p.change.arrow} ${p.change.diff >= 0 ? '+' : ''}${p.change.diff} vs ${p.change.prev})` : ''}`)
      }
      const t = targetPace(ps.payload.rows, now)
      console.log(`This month: ${t.paid} of ${t.target} · ${t.perDay} a day needed over ${t.daysLeft} days`)
    }
    const ov = (by.get('overview:7') as { payload: Record<string, { count: number }> } | undefined)?.payload
    console.log('Paid, not welcomed:', ov?.['todo-not-welcomed']?.count ?? 'not written yet')
    await c.query('rollback')
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
