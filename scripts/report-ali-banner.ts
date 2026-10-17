/**
 * scripts/report-ali-banner.ts — read-only: the record behind the "payment in
 * progress" banner the Owner saw on 17 Oct 2026, for the tutor accounts whose
 * first name is Ali. No contact details are printed.
 *   npx tsx --env-file=.env.local scripts/report-ali-banner.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const rows = (
      await c.query(
        `select pr.id, pr.full_name, pr.is_suspended, pr.is_banned, pr.paused_by_user_at, pr.hidden_from_public,
                tp.verified_fee_paid_at, pr.last_sign_in_at
           from profiles pr join tutor_profiles tp on tp.id = pr.id
          where pr.role = 'tutor' and split_part(lower(btrim(pr.full_name)), ' ', 1) = 'ali'`,
      ).catch(async () =>
        c.query(
          `select pr.id, pr.full_name, pr.is_suspended, pr.is_banned, pr.paused_by_user_at, pr.hidden_from_public,
                  tp.verified_fee_paid_at, null as last_sign_in_at
             from profiles pr join tutor_profiles tp on tp.id = pr.id
            where pr.role = 'tutor' and split_part(lower(btrim(pr.full_name)), ' ', 1) = 'ali'`,
        ),
      )
    ).rows
    for (const r of rows) {
      const auth = (await c.query(`select last_sign_in_at from auth.users where id = $1`, [r.id])).rows[0]
      console.log(
        `Ali ${String(r.id).slice(0, 8)} suspended=${r.is_suspended} banned=${r.is_banned} selfPaused=${!!r.paused_by_user_at} hidden=${r.hidden_from_public} ` +
          `feePaidAt=${r.verified_fee_paid_at?.toISOString?.() ?? r.verified_fee_paid_at} lastSignIn=${auth?.last_sign_in_at?.toISOString?.() ?? '-'}`,
      )
      const pays = (
        await c.query(
          `select id, plan_code, amount_pkr, provider, method, status, created_at, reviewed_at, refunded_at,
                  screenshot_path is not null as has_file, coalesce(btrim(reference),'') <> '' as has_ref, rejection_reason
             from payments where user_id = $1 order by created_at`,
          [r.id],
        )
      ).rows
      for (const p of pays)
        console.log(
          `   payment ${String(p.id).slice(0, 8)} ${p.plan_code} Rs ${p.amount_pkr} provider=${p.provider} method=${p.method ?? '-'} ` +
            `status=${p.status} created=${p.created_at.toISOString()} reviewed=${p.reviewed_at?.toISOString?.() ?? '-'} ` +
            `refunded=${!!p.refunded_at} receiptFile=${p.has_file} reference=${p.has_ref}${p.rejection_reason ? ` reason="${p.rejection_reason}"` : ''}`,
        )
      const audit = (
        await c.query(
          `select action, created_at, actor_role from admin_audit_log where target_id = $1::text and action like 'payment%' order by created_at`,
          [r.id],
        )
      ).rows
      for (const a of audit) console.log(`   audit ${a.action} ${a.created_at.toISOString()} by ${a.actor_role}`)
    }
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
