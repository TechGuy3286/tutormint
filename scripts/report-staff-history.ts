/**
 * scripts/report-staff-history.ts — READ-ONLY. Staff-related audit history for
 * named accounts (action, role, date only), and any other account whose name
 * matches a keep-list name. Never prints a phone, CNIC or email.
 *   npx tsx --env-file=.env.local scripts/report-staff-history.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const NAMES = ['Khizra Danish', 'Aqsa Mughal', 'Mahnoor Amin', 'Zubia Bashir', 'Aseer Ul Hassan', 'Nabeel', 'Inzamam Ullah', 'Javeria Fiaz', 'Qasim', 'Alee Sabeer', 'Rai Mohsin Raza']

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  for (const n of NAMES) {
    const r = await c.query(
      `select p.id, p.full_name, p.role, p.admin_role, p.is_suspended, p.hidden_from_public
         from profiles p where p.full_name ilike $1 or p.full_name ilike $2 order by p.created_at`,
      [n, `${n} %`],
    )
    console.log(`\n== ${n}: ${r.rows.length} account(s)`)
    console.table(r.rows)
    for (const row of r.rows) {
      const a = await c.query(
        `select action, actor_role, created_at, detail->>'adminRole' as from_role, detail->>'to' as to_role
           from admin_audit_log where target_id = $1 and action like 'staff.%' order by created_at`,
        [row.id],
      )
      if (a.rows.length) console.table(a.rows)
    }
  }
  await c.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
