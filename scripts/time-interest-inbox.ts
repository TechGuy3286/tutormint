/**
 * scripts/time-interest-inbox.ts — PR-11: how long each part of the Parent
 * interest inbox build takes (read-only, production). Prints timings and row
 * counts only — never a name, phone or id.
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/time-interest-inbox.ts
 */
import { createAdminClient } from '../lib/supabase/admin'
import { loadInterestInboxFresh } from '../lib/interestInbox'

async function main() {
  const admin = createAdminClient()
  if (!admin) throw new Error('service role unavailable')
  const runs = Number(process.argv[2] ?? 3)
  const times: number[] = []
  let rows = 0
  for (let i = 0; i < runs; i++) {
    const t0 = Date.now()
    const inbox = await loadInterestInboxFresh()
    times.push(Date.now() - t0)
    rows = inbox.rows.length
  }
  console.log(`rows ${rows} · build ms: ${times.join(', ')}`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(String((e as Error).message ?? e))
    process.exit(1)
  },
)
