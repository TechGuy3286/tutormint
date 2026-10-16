// scripts/report-invalid-recipients.ts — READ ONLY (owner, 16 Oct 2026).
//
// Every stored address an email can go to, checked against the rule the send
// module and the Supabase Auth call sites now use (lib/notify/recipient). An
// address that fails would have been refused by Resend with HTTP 422; it is now
// skipped with a recorded reason. Prints masked addresses only.
//
//   npx tsx --env-file=.env.local scripts/report-invalid-recipients.ts

// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { recipientProblem } from '../lib/notify/recipient'

function mask(a: string): string {
  const at = a.lastIndexOf('@')
  return at < 0 ? `${a.slice(0, 3)}…(no @)` : `${a.slice(0, 2)}…${a.slice(at)}`
}

const SOURCES: [string, string][] = [
  ['auth.users.email', `select email as a from auth.users where email is not null`],
  ['auth.users.email_change (pending)', `select email_change as a from auth.users where coalesce(email_change, '') <> ''`],
  ['profiles.email', `select email as a from profiles where email is not null`],
  ['tutor_search_alerts.contact (email)', `select contact as a from tutor_search_alerts where channel = 'email'`],
]

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    for (const [label, sql] of SOURCES) {
      const rows = ((await c.query(sql)).rows as { a: string }[]).map((r) => r.a)
      const bad = rows.map((a) => [a, recipientProblem(a)] as const).filter((x) => x[1])
      console.log(`${label}: ${rows.length} addresses, ${bad.length} would be refused`)
      for (const [a, p] of bad) console.log('   ', mask(a), '<-', p)
    }
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
