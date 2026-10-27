/**
 * scripts/report-paused-email-recipients.ts — READ ONLY (owner, 27 Oct 2026).
 * Who received the "tuition paused" emails on one UTC day: account TYPES and
 * counts only. Never prints an address, a name or an id.
 *
 *   npx tsx --env-file=.env.local scripts/report-paused-email-recipients.ts [YYYY-MM-DD]
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const day = process.argv[2] ?? '2026-10-27'
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  try {
    const q = await c.query(
      `with s as (
         select lower(recipient) addr, status from email_sends
          where coalesce(template, job) = 'tuition_paused'
            and created_at >= $1::date and created_at < ($1::date + 1)
       )
       select s.status,
              case
                when p.id is null then 'no account with that address'
                when p.is_team_account then 'team account (staff-posted tuitions)'
                when p.role = 'admin' then 'staff account'
                when coalesce(p.is_seed,false) or coalesce(p.is_test_name,false) or coalesce(p.hidden_from_public,false) then 'test / seed / hidden account'
                when s.addr like '%@users.tutormint.org' then 'placeholder address'
                when p.role in ('parent','academy') then 'real parent'
                when p.role = 'tutor' then 'tutor account'
                else 'other: ' || coalesce(p.role::text,'?')
              end as kind,
              count(*)::int n,
              count(distinct s.addr)::int people
         from s left join profiles p on lower(p.email) = s.addr
        group by 1, 2 order by 3 desc`,
      [day],
    )
    let total = 0
    for (const r of q.rows) {
      console.log(`${r.status} · ${r.kind} · ${r.n} emails · ${r.people} distinct addresses`)
      total += r.n
    }
    console.log(`TOTAL tuition_paused rows on ${day} (UTC): ${total}`)
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(String(e?.message ?? e))
  process.exit(1)
})
