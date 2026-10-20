/**
 * scripts/report-grants-without-payment.ts — READ ONLY (owner, 20 Oct 2026).
 *
 * Manual badge / plan grants of the last 60 days that have no payment behind
 * them, so the Owner can link the matching bank credits by hand. Counts and
 * member FIRST names only — never a phone number, email, account number or IBAN.
 * Changes nothing.
 *
 *   npx tsx --env-file=.env.local scripts/report-grants-without-payment.ts
 */

// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const first = (n: string | null) => (n ?? '').trim().split(/\s+/)[0] || '(no name)'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    // 1. Every plan.grant in the last 60 days, and whether a counted payment for
    //    the same plan exists for that member.
    const grants = await c.query(`
      with g as (
        select a.target_id::uuid as user_id, coalesce(a.detail->>'planCode', '?') as plan_code, max(a.created_at) as granted_at
          from admin_audit_log a
         where a.action = 'plan.grant' and a.created_at > now() - interval '60 days'
         group by 1, 2
      )
      select g.user_id, g.plan_code, g.granted_at, p.full_name, p.role,
             exists (
               select 1 from payments x
                where x.user_id = g.user_id and x.plan_code = g.plan_code
                  and x.status = 'approved' and coalesce(x.refunded_amount_pkr, 0) = 0 and x.refunded_at is null
             ) as has_payment
        from g left join profiles p on p.id = g.user_id
       order by g.granted_at desc`)

    const missing = grants.rows.filter((r: { has_payment: boolean }) => !r.has_payment)
    console.log(`Manual grants in the last 60 days: ${grants.rows.length} (member + plan)`)
    console.log(`  with a payment behind them: ${grants.rows.length - missing.length}`)
    console.log(`  with NO payment behind them: ${missing.length}`)
    const byPlan = new Map<string, string[]>()
    for (const r of missing as { plan_code: string; full_name: string | null; role: string | null; granted_at: Date }[]) {
      const key = r.plan_code === 'verified' ? 'Verification Fee' : r.plan_code
      byPlan.set(key, [...(byPlan.get(key) ?? []), `${first(r.full_name)} (${r.role ?? '?'}, ${new Date(r.granted_at).toISOString().slice(0, 10)})`])
    }
    for (const [plan, names] of byPlan) console.log(`    ${plan}: ${names.length} — ${names.join(', ')}`)

    // 2. Belt and braces: tutors whose fee flag was set in the last 60 days by
    //    ANY path, with no counted fee payment at all.
    const fee = await c.query(`
      select p.full_name, tp.verified_fee_paid_at
        from tutor_profiles tp join profiles p on p.id = tp.id
       where tp.verified_fee_paid_at > now() - interval '60 days'
         and coalesce(p.is_seed, false) = false and coalesce(p.is_test_name, false) = false
         and not exists (
           select 1 from payments x where x.user_id = tp.id and x.plan_code = 'verified'
              and x.status = 'approved' and coalesce(x.refunded_amount_pkr, 0) = 0 and x.refunded_at is null)
       order by tp.verified_fee_paid_at desc`)
    console.log(`\nTutors marked fee-paid in the last 60 days with no Verification Fee payment: ${fee.rows.length}`)
    if (fee.rows.length) console.log('  ' + (fee.rows as { full_name: string | null; verified_fee_paid_at: Date }[]).map((r) => `${first(r.full_name)} (${new Date(r.verified_fee_paid_at).toISOString().slice(0, 10)})`).join(', '))
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
