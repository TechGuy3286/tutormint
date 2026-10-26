/**
 * scripts/report-samia-pay-loop.ts — READ ONLY (owner, 26 Oct 2026).
 *
 * The payment-page loop hotfix: every tutor account named "Samia" — fee flag,
 * document statuses, onboarding, payments (no amounts beyond the plan price,
 * no references beyond whether one exists), plan. Names and ids only: never a
 * phone number, email, CNIC, account number or key. Changes nothing.
 *
 *   npx tsx --env-file=.env.local scripts/report-samia-pay-loop.ts
 */

// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const ps = await c.query(
      `select p.id, p.full_name, p.role, p.admin_role, p.created_at, p.verification_state, p.cnic_verified_at is not null as cnic_ok,
              p.profile_pic_status, p.selfie_status, p.phone_verified_at is not null as mobile_ok,
              p.is_suspended, p.is_banned, p.hidden_from_public, p.is_test_name,
              tp.verified_fee_paid_at, tp.verification_status, tp.onboarded_at,
              p.phone_gate_required, p.email_pending_confirm, p.paused_by_user_at is not null as self_paused,
              p.phone_number is not null as has_mobile, p.email like '%@users.tutormint.org' as synthetic_email,
              coalesce(nullif(btrim(p.city),''), nullif(btrim(tp.city),'')) is not null as has_city,
              u.email_confirmed_at is not null as auth_email_confirmed, u.last_sign_in_at
         from profiles p left join tutor_profiles tp on tp.id = p.id left join auth.users u on u.id = p.id
        where p.full_name ilike '%samia%' and p.role = 'tutor'`,
    )
    for (const p of ps.rows) {
      console.log('Member:', p)
      const pays = await c.query(
        `select id, plan_code, status, provider, method, provider_ref is not null as has_ref,
                screenshot_path is not null as has_receipt, reference is not null as has_txn,
                checkout_closed_at, checkout_close_reason, return_to, reviewed_at, created_at
           from payments where user_id = $1 order by created_at`,
        [p.id],
      )
      console.log('Payments:', pays.rows)
      const subs = await c.query(`select plan_code, status, starts_at, expires_at from subscriptions where user_id = $1`, [p.id])
      console.log('Subs:', subs.rows)
      const subj = await c.query(`select count(*)::int n from tutor_subjects where tutor_id = $1`, [p.id])
      console.log('Subjects:', subj.rows[0].n)
      // Page paths only (no query string beyond what the path carries), today.
      const ev = await c.query(
        `select created_at, kind, path, label from activity_events
          where user_id = $1 and created_at > now() - interval '36 hours' order by created_at`,
        [p.id],
      )
      const ss = await c.query(
        `select started_at, last_seen_at, active_ms, page_count, is_staff, left(user_agent, 120) ua from activity_sessions
          where user_id = $1 and started_at > now() - interval '36 hours' order by started_at`,
        [p.id],
      )
      for (const s of ss.rows) console.log('  session', s.started_at.toISOString(), s.last_seen_at.toISOString(), s.active_ms, s.page_count, s.is_staff, s.ua)
      for (const e of ev.rows) console.log('  ev', e.created_at.toISOString(), e.kind, e.path, e.label ?? '')
      const ua = await c.query(
        `select event_type, created_at from user_activity_log where user_id = $1 and created_at > now() - interval '36 hours' order by created_at`,
        [p.id],
      )
      for (const e of ua.rows) console.log('  log', e.created_at.toISOString(), e.event_type)
      const au = await c.query(
        `select action, created_at, actor_role from admin_audit_log where target_id = $1::text and created_at > now() - interval '36 hours' order by created_at`,
        [p.id],
      )
      for (const e of au.rows) console.log('  audit', e.created_at.toISOString(), e.action, e.actor_role)
    }
    const mode = await c.query(`select value from app_settings where key = 'onboarding.new_mode'`)
    console.log('onboarding.new_mode:', mode.rows[0]?.value ?? '(unset)')
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
