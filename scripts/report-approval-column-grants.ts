/**
 * scripts/report-approval-column-grants.ts — READ ONLY. Which approval columns
 * can the `authenticated` role UPDATE (table or column privilege)? Feeds the
 * Owner-only approvals guard (migration 176).
 *   npx tsx --env-file=.env.local scripts/report-approval-column-grants.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const COLS: Record<string, string[]> = {
  profiles: [
    'cnic_verified_at', 'cnic_reviewed_at', 'cnic_reviewed_by', 'cnic_number', 'verification_state', 'verification_rejection_reason',
    'address_verified_at', 'address_status', 'address_reason', 'address_reviewed_at', 'address_reviewed_by',
    'profile_pic_status', 'profile_pic_reason', 'profile_pic_reviewed_at', 'profile_pic_reviewed_by', 'profile_pic_rereview_at',
    'selfie_status', 'selfie_reason', 'selfie_reviewed_at', 'selfie_reviewed_by',
  ],
  tutor_profiles: ['video_status'],
  payments: ['status', 'reviewed_at', 'reviewed_by', 'rejection_reason'],
}

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  for (const [t, cols] of Object.entries(COLS)) {
    for (const col of cols) {
      const r = await c.query(`select has_column_privilege('authenticated', $1, $2, 'UPDATE') as ok`, [`public.${t}`, col])
      console.log(`${t}.${col}: authenticated UPDATE = ${r.rows[0].ok}`)
    }
  }
  await c.end()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
