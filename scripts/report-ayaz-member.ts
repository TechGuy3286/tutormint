/**
 * scripts/report-ayaz-member.ts — READ ONLY (owner, 21 Oct 2026).
 *
 * Every account named "Ayaz Hussain": its fee flag, document statuses,
 * payments, subscriptions and recent admin actions. Never prints a phone
 * number, email, account number or IBAN. Changes nothing.
 *
 *   npx tsx --env-file=.env.local scripts/report-ayaz-member.ts
 */

// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const ps = await c.query(
      `select p.id, p.full_name, p.role, p.created_at, p.verification_state, p.cnic_verified_at, p.profile_pic_status, p.selfie_status,
              p.is_suspended, tp.verified_fee_paid_at, tp.verification_status, tp.onboarded_at
         from profiles p left join tutor_profiles tp on tp.id = p.id
        where p.full_name ilike '%ayaz%hussain%'`,
    )
    for (const p of ps.rows) {
      console.log('Member:', p)
      const pays = await c.query(
        `select id, plan_code, amount_pkr, status, provider, method, provider_ref, reference, screenshot_path is not null as has_receipt,
                checkout_closed_at, checkout_close_reason, reviewed_at, created_at, note
           from payments where user_id = $1 order by created_at`,
        [p.id],
      )
      console.log('Payments:', pays.rows)
      const subs = await c.query(`select id, plan_code, status, payment_id, created_at from subscriptions where user_id = $1`, [p.id])
      console.log('Subs:', subs.rows)
      const audit = await c.query(
        `select action, created_at, detail from admin_audit_log where target_id = $1::text or detail->>'userId' = $1::text order by created_at desc limit 25`,
        [p.id],
      )
      for (const a of audit.rows) console.log('  audit', a.created_at.toISOString(), a.action, JSON.stringify(a.detail).slice(0, 200))
    }
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
