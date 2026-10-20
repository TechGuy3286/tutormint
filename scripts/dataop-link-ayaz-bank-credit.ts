/**
 * scripts/dataop-link-ayaz-bank-credit.ts — the one-time fix of 21 Oct 2026
 * (Owner's instruction). Links Ayaz Hussain's Raast bank credit (ref
 * 261838203082) to him through /api/internal/link-ayaz-bank-credit, which runs
 * the same code as Finance → "Link to member". Prints Revenue for 20 Oct 2026
 * (Pakistan time) before and after, and what changed. Never prints a phone
 * number, email, account number or IBAN.
 *
 *   npx tsx --env-file=.env.local scripts/dataop-link-ayaz-bank-credit.ts           # dry run
 *   npx tsx --env-file=.env.local scripts/dataop-link-ayaz-bank-credit.ts --apply
 */

// @ts-expect-error pg ships no bundled types
import pg from 'pg'

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }

const SITE = 'https://www.tutormint.org'
const MEMBER = '58346e9e-7a03-45c2-b3af-cec96ee3c5e1'

async function revenue20Oct(c: Db) {
  const r = await c.query(
    `select count(*)::int n, coalesce(sum(amount_pkr), 0)::numeric total from payments
      where status = 'approved' and user_id is not null and coalesce(refunded_amount_pkr, 0) = 0 and refunded_at is null
        and (reviewed_at at time zone 'Asia/Karachi')::date = date '2026-10-20'`,
  )
  return r.rows[0]
}

async function ayazPayments(c: Db) {
  const r = await c.query(
    `select provider_ref, provider, method, status, amount_pkr, reference, checkout_close_reason, reviewed_at from payments where user_id = $1 order by created_at`,
    [MEMBER],
  )
  return r.rows
}

async function main() {
  const apply = process.argv.includes('--apply')
  const secret = process.env.CRON_SECRET
  if (!secret) throw new Error('CRON_SECRET is not set.')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const before = await revenue20Oct(c)
    console.log('Revenue 20 Oct (PKT) before:', before)
    console.log("Ayaz's payments before:", await ayazPayments(c))
    const res = await fetch(`${SITE}/api/internal/link-ayaz-bank-credit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ apply }),
    })
    console.log(`Route: ${res.status}`, await res.json().catch(() => null))
    if (apply) {
      console.log('Revenue 20 Oct (PKT) after:', await revenue20Oct(c))
      console.log("Ayaz's payments after:", await ayazPayments(c))
      const link = await c.query(
        `select kind, note from settlement_links where transfer_id = 'c1513148-5452-4b3e-9a5d-daf4909f7ea0' and removed_at is null`,
      )
      console.log('Settlement links on the credit:', link.rows)
      const audit = await c.query(
        `select action, detail->>'mode' mode, detail->>'note' note, detail->'replacedAutoMatch' replaced, detail->>'closedCheckouts' closed
           from admin_audit_log where action = 'payment.bank_link' and detail->>'userId' = $1 order by created_at desc limit 1`,
        [MEMBER],
      )
      console.log('Audit:', audit.rows)
    } else {
      console.log('dry run — nothing changed')
    }
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
