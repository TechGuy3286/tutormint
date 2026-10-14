/**
 * scripts/report-recent-otp-sends.ts — READ-ONLY. The newest code records, so a
 * deploy can be checked against a REAL send rather than assumed: the newest
 * pending mobile signups and phone_otps rows, time and purpose only — never a
 * number or a code.
 *   npx tsx --env-file=.env.local scripts/report-recent-otp-sends.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const pending = await c.query(`select created_at from pending_signups order by created_at desc limit 3`)
  const otps = await c.query(`select created_at, purpose, (user_id is null) as decoy from phone_otps order by created_at desc limit 3`)
  console.log('pending_signups newest:', JSON.stringify(pending.rows))
  console.log('phone_otps newest:', JSON.stringify(otps.rows))
  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
