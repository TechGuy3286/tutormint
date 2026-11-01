// scripts/report-auth-email-volume.ts — READ ONLY (owner, 31 Oct 2026).
//
// Why Supabase Auth's SMTP sends come in pairs, in counts only (never an
// address). Supabase's "Secure email change" mails BOTH the current sign-in
// address and the new one on every supabase.auth.updateUser({ email }); for a
// mobile sign-up the current address is the no-mailbox placeholder
// <msisdn>@users.tutormint.org. This counts, per day (UTC) for the last 15
// days: email changes requested (email_change_sent_at), how many of those came
// from a placeholder address, sign-up confirmations sent (confirmation_sent_at)
// and password-reset emails (recovery_sent_at). Each timestamp holds only the
// LATEST send per account, so these are lower bounds.
//
//   npx tsx --env-file=.env.local scripts/report-auth-email-volume.ts

// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const { rows } = await c.query(`
      with d as (select generate_series((now() at time zone 'utc')::date - 14, (now() at time zone 'utc')::date, '1 day')::date as day)
      select d.day::text,
        (select count(*) from auth.users u where u.email_change_sent_at::date = d.day) as changes,
        (select count(*) from auth.users u where u.email_change_sent_at::date = d.day and u.email ilike '%@users.tutormint.org') as changes_from_placeholder,
        (select count(*) from auth.users u where u.confirmation_sent_at::date = d.day) as confirmations,
        (select count(*) from auth.users u where u.recovery_sent_at::date = d.day) as resets
      from d order by d.day`)
    console.log('day        changes  fromPlaceholder  confirmations  resets')
    for (const r of rows) console.log(`${r.day}  ${String(r.changes).padStart(7)}  ${String(r.changes_from_placeholder).padStart(15)}  ${String(r.confirmations).padStart(13)}  ${String(r.resets).padStart(6)}`)
    const { rows: pend } = await c.query(`
      select count(*) filter (where coalesce(email_change,'') <> '') as pending,
             count(*) filter (where coalesce(email_change,'') <> '' and email ilike '%@users.tutormint.org') as pending_from_placeholder
      from auth.users`)
    console.log('pending email changes:', pend[0].pending, 'from a placeholder address:', pend[0].pending_from_placeholder)
  } finally {
    await c.end()
  }
}
void main()
