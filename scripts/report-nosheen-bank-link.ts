/**
 * scripts/report-nosheen-bank-link.ts — READ ONLY (hotfix, 26 Oct 2026).
 *
 * Why did "Record a bank payment" fail for the tutor Nosheen Waheed? Prints her
 * account id prefix, role, fee state and payments (plan, status, provider —
 * never an amount detail beyond the plan's), today's bank-link audit rows, the
 * bank credits the link screen offers (date, time, amount, source, state —
 * never a reference, sender name or account digits), and a DRY RUN of the real
 * linkCreditToMember for each hand-entered credit (dryRun returns before any
 * write). Changes nothing.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/report-nosheen-bank-link.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { linkableCredits, linkCreditToMember } from '@/lib/bankPaymentLink'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 20000 })
  await c.connect()
  try {
    const m = await c.query(
      `select p.id, p.role, tp.verified_fee_paid_at from profiles p left join tutor_profiles tp on tp.id = p.id where p.full_name ilike '%nosheen%waheed%'`,
    )
    console.log('members matched:', m.rows.length)
    for (const r of m.rows) console.log(' ', String(r.id).slice(0, 8), r.role, 'feePaid=', !!r.verified_fee_paid_at)
    const owner = await c.query(`select id from profiles where admin_role = 'owner' limit 1`)
    const ownerId = owner.rows[0]?.id as string
    for (const r of m.rows) {
      const pays = await c.query(
        `select plan_code, status, provider, method, created_at, reviewed_at, checkout_closed_at, screenshot_path is not null rcpt from payments where user_id = $1 order by created_at`,
        [r.id],
      )
      console.log('payments of', String(r.id).slice(0, 8))
      for (const p of pays.rows) console.log('  ', p.plan_code, p.status, p.provider, p.method, p.created_at?.toISOString?.(), 'reviewed', p.reviewed_at?.toISOString?.() ?? '-', 'closed', !!p.checkout_closed_at, 'receipt', p.rcpt)
    }
    const audits = await c.query(
      `select action, created_at, detail->>'mode' mode, detail->>'settlementLinked' linked from admin_audit_log where action like 'payment.%' and created_at > now() - interval '1 day' order by created_at`,
    )
    console.log('payment audit rows (24h):')
    for (const a of audits.rows) console.log('  ', a.action, a.created_at.toISOString(), a.mode ?? '', a.linked ?? '')
    const manual = await c.query(
      `select id, transferred_on, transferred_time, amount_pkr, source, gateway, created_at from bank_transfers where created_at > now() - interval '3 days' order by created_at`,
    )
    console.log('bank credits added in 3 days:')
    for (const t of manual.rows) console.log('  ', String(t.id).slice(0, 8), t.transferred_on instanceof Date ? t.transferred_on.toISOString() : t.transferred_on, JSON.stringify(t.transferred_time), t.amount_pkr, t.source, t.gateway)

    const t0 = Date.now()
    const offered = await linkableCredits()
    console.log(`linkableCredits(): ${offered ? offered.length : 'null'} in ${Date.now() - t0} ms`)
    for (const cr of offered ?? []) console.log('  ', cr.id.slice(0, 8), cr.date, JSON.stringify(cr.time), cr.amountPkr, 'paypro=', cr.isPaypro)

    const tutor = m.rows.find((r: { role: string; id: string }) => r.role === 'tutor')
    if (tutor && ownerId) {
      for (const t of manual.rows) {
        try {
          const res = await linkCreditToMember(
            { transferId: t.id, memberId: tutor.id, planCode: 'verified', amountPkr: Number(t.amount_pkr) },
            { id: ownerId, adminRole: 'owner', email: null },
            { dryRun: true },
          )
          console.log('dry run', String(t.id).slice(0, 8), JSON.stringify(res))
        } catch (e) {
          console.log('dry run THREW', String(t.id).slice(0, 8), (e as Error).stack?.split('\n').slice(0, 4).join(' / '))
        }
      }
    }
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
