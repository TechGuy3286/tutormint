/**
 * scripts/report-parent-interest.ts — READ-ONLY (PR-08). Counts only — never a
 * name, phone or email:
 *   - parent-interest events from the backfill, by kind, and how many are still
 *     waiting for their alert (and for how many tutors);
 *   - accounts held by the burst check, by status;
 *   - a dry run of the next daily teaser run (what it would send, by type);
 *   - today's WhatsApp updates queue, paid and unpaid.
 * The dry run and the queue read through the app's own code (server-only is
 * satisfied by the react-server condition); nothing is written.
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/report-parent-interest.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    await c.query('begin read only')
    const rows = async (sql: string) => (await c.query(sql)).rows as Record<string, unknown>[]
    const done = await rows(`select value from app_settings where key = 'interest.backfill_done_at'`)
    console.log(`backfill ran: ${done.length ? 'yes' : 'no'}`)
    for (const r of await rows(`select source, kind, count(*)::int n, count(*) filter (where alerted_at is null)::int waiting, count(distinct tutor_id)::int tutors from parent_interest_events group by 1, 2 order by 1, 2`)) {
      console.log(`events ${r.source}/${r.kind}: ${r.n} (waiting for an alert: ${r.waiting}; tutors: ${r.tutors})`)
    }
    const waitingTutors = await rows(`select count(distinct tutor_id)::int n from parent_interest_events where source = 'backfill' and alerted_at is null`)
    console.log(`tutors with backfilled events still to alert: ${waitingTutors[0].n}`)
    for (const r of await rows(`select status, count(*)::int n from interest_holds group by 1 order by 1`)) console.log(`held accounts ${r.status}: ${r.n}`)
    if ((await rows(`select count(*)::int n from interest_holds`))[0].n === 0) console.log('held accounts: 0')
    await c.query('rollback')
  } finally {
    await c.end()
  }

  if (process.argv.includes('--backfill-dry')) {
    // What the one-time backfill would add (nothing written).
    const { runInterestBackfill } = await import('../lib/parentInterest')
    const b = await runInterestBackfill({ dryRun: true, force: true })
    console.log(`backfill (dry): would add ${JSON.stringify(b.inserted)}; would hold ${b.holdsCreated} accounts; errors ${b.errors.length}`)
  }
  try {
    const { runTutorTeasers } = await import('../lib/tutorTeasers')
    const r = await runTutorTeasers({ dryRun: true })
    console.log(`next teaser run (dry): eligible ${r.eligible} (unpaid ${r.unpaidEligible}); would send ${JSON.stringify(r.sent)}; parent-interest alerts from the backfill ${r.interestFromBackfill}; errors ${r.errors.length}`)
  } catch (e) {
    console.log(`teaser dry run unavailable: ${String((e as Error).message).slice(0, 120)}`)
  }
  try {
    const { loadWaQueue } = await import('../lib/waUpdates')
    const q = await loadWaQueue()
    console.log(`WhatsApp queue today: ${q.toSend} to send (paid ${q.paidToSend}, unpaid ${q.unpaidToSend}); unpaid rows listed ${q.unpaidRows} of cap ${q.unpaidCap}; sent today ${q.rows.length - q.toSend}`)
  } catch (e) {
    console.log(`queue unavailable: ${String((e as Error).message).slice(0, 120)}`)
  }
}

void main()
