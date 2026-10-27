/**
 * scripts/report-contact-consent.ts — READ ONLY (owner, 27 Oct 2026). How many
 * tuitions each staff member posted (team-account tuitions) with a parent
 * number that belongs to no account. Counts only — never a number. The same
 * rule as the Withdraw a contact page (lib/contactWithdrawCore consentCounts).
 *
 *   npx tsx --env-file=.env.local scripts/report-contact-consent.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

import { consentCounts } from '../lib/contactWithdrawCore'
import { normalisePkMobile } from '../lib/phone'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  try {
    const rows = (
      await c.query(`
        select o.posted_by, coalesce(jc.contact_phone, jc.contact_whatsapp) as number, j.status
          from jobs j
          join profiles t on t.id = j.parent_id and t.is_team_account
          join job_contacts jc on jc.job_id = j.id
          left join tuition_owners o on o.job_id = j.id`)
    ).rows as { posted_by: string | null; number: string | null; status: string }[]
    const profiles = (await c.query(`select id, full_name, phone_number, whatsapp, secondary_phone, is_team_account from profiles`)).rows as {
      id: string
      full_name: string | null
      phone_number: string | null
      whatsapp: string | null
      secondary_phone: string | null
      is_team_account: boolean | null
    }[]
    const accountNumbers = new Set<string>()
    for (const p of profiles) {
      if (p.is_team_account) continue
      for (const v of [p.phone_number, p.whatsapp, p.secondary_phone]) {
        const m = normalisePkMobile(v)
        if (m) accountNumbers.add(m)
      }
    }
    const names = new Map(profiles.map((p) => [p.id, p.full_name ?? 'Former staff']))
    const out = consentCounts(rows.map((r) => ({ postedBy: r.posted_by, number: r.number })), accountNumbers, (id) => names.get(id) ?? 'Former staff')
    const total = out.reduce((s, r) => s + r.count, 0)
    console.log(`Team tuitions with a contact row: ${rows.length}`)
    console.log(`With a parent number that belongs to no account: ${total}`)
    for (const r of out) console.log(`  ${r.staff}: ${r.count}`)
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
