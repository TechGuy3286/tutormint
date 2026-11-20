/**
 * scripts/check-inbox-stored.ts — PR-12 Part F. READ-ONLY on production.
 * Builds the Parent interest inbox fresh FOR THE STORED COPY'S OWN MOMENT and
 * compares it with the stored copy (admin_summary 'interest-inbox'); also checks
 * that a JSON round trip (what jsonb keeps) loses nothing. Writes nothing.
 * Prints counts and short ids only — never a name or a number.
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/check-inbox-stored.ts
 */
import { compareInboxSnapshot } from '@/lib/interestInbox'

async function main() {
  const r = await compareInboxSnapshot()
  console.log('stored copy:', r.stored ? `${r.stored.builtAt} (${r.stored.ageSeconds}s old, PK day ${r.stored.pkDay}, usable now: ${r.stored.usableNow})` : 'none')
  console.log('newest change:', r.newestChange)
  console.log('rows: fresh', r.rows.fresh, '· stored', r.rows.stored)
  console.log('same moment:', r.sameMoment.length === 0 ? 'MATCH' : `${r.sameMoment.length} difference(s)`)
  for (const d of r.sameMoment.slice(0, 40)) console.log('   ', d)
  console.log('JSON round trip:', r.roundTrip.length === 0 ? 'MATCH' : r.roundTrip.join('; '))
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
