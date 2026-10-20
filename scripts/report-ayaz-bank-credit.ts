/**
 * scripts/report-ayaz-bank-credit.ts — READ ONLY (owner, 20 Oct 2026).
 *
 * The facts behind "Approve a pending bank-transfer payment from its matched
 * bank credit": the bank credit with reference 261838203082, its settlement
 * links, and the payments of the member they point at. Never prints a phone
 * number, email, account number or IBAN. Changes nothing.
 *
 *   npx tsx --env-file=.env.local scripts/report-ayaz-bank-credit.ts
 */

// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const credit = await c.query(
      `select id, transferred_on, transferred_time, amount_pkr, reference, gateway, created_at from bank_transfers where reference = '261838203082'`,
    )
    console.log('Credit:', credit.rows)
    for (const cr of credit.rows) {
      const links = await c.query(`select id, kind, target, note, removed_at, created_at from settlement_links where transfer_id = $1 order by created_at`, [cr.id])
      console.log('Links:', links.rows)
    }
    const pay = await c.query(
      `select id, user_id, plan_code, amount_pkr, status, provider, method, provider_ref, reference, screenshot_path is not null as has_receipt,
              checkout_closed_at, checkout_close_reason, reviewed_at, created_at
         from payments where provider_ref = 'TM-MVCYYLHV-ED2EEA6E1C85'`,
    )
    console.log('Payment:', pay.rows)
    const uid = pay.rows[0]?.user_id
    if (uid) {
      const prof = await c.query(`select full_name, role from profiles where id = $1`, [uid])
      const tp = await c.query(
        `select verified_fee_paid_at, verification_status from tutor_profiles where id = $1`,
        [uid],
      )
      const pr = await c.query(`select verification_state, cnic_verified_at, profile_pic_status, selfie_status, is_suspended from profiles where id = $1`, [uid])
      console.log('Member:', prof.rows[0]?.full_name, prof.rows[0]?.role, tp.rows[0], pr.rows[0])
      const all = await c.query(
        `select id, plan_code, amount_pkr, status, provider, method, provider_ref, screenshot_path is not null as has_receipt,
                checkout_closed_at, checkout_close_reason, reviewed_at, created_at
           from payments where user_id = $1 order by created_at`,
        [uid],
      )
      console.log('All payments:', all.rows)
      const subs = await c.query(`select id, plan_code, status, payment_id from subscriptions where user_id = $1`, [uid])
      console.log('Subs:', subs.rows)
      const audit = await c.query(
        `select action, created_at, detail from admin_audit_log where target_id = $1 or detail->>'userId' = $1 order by created_at desc limit 20`,
        [uid],
      )
      console.log('Audit:', audit.rows.map((a: { action: string; created_at: string }) => `${a.created_at} ${a.action}`))
    }
    const rev = await c.query(
      `select count(*)::int n, coalesce(sum(amount_pkr),0)::numeric total from payments
        where status='approved' and coalesce(refunded_amount_pkr,0)=0 and refunded_at is null
          and (reviewed_at at time zone 'Asia/Karachi')::date = date '2026-10-20'`,
    )
    console.log('Approved 20 Oct (PKT):', rev.rows[0])
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
