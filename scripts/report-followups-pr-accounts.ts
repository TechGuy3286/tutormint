/**
 * scripts/report-followups-pr-accounts.ts — READ ONLY (owner, 21 Oct 2026).
 * Do the Part D accounts share a mobile / email with each other or with a staff
 * account? Prints only true/false, never the values.
 *   npx tsx --env-file=.env.local scripts/report-followups-pr-accounts.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const IDS = {
  aqsaStaff: '51e6f8da-98ec-403f-ae13-d65ec059b8ab',
  aqsaTutorA: '532e5da5-6780-45d7-89d6-3fdabde3574c',
  aqsaTutorB: 'd5c10c45-0efd-473b-a5f5-5863c2868485',
  javeriaTutor: 'c656ab23-8de7-4ab0-8d14-1ee843b28294',
  javeriaStaff: '02c8c39b-df1e-4ebb-b407-a2d253dbad05',
}

const last10 = (v: string | null) => {
  const d = (v ?? '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : null
}

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const r = await c.query(`select id, email, phone_number, whatsapp from profiles where id = any($1)`, [Object.values(IDS)])
    const by = new Map(r.rows.map((x: { id: string }) => [x.id, x]))
    const facts = (id: string) => {
      const p = by.get(id) as { email: string | null; phone_number: string | null; whatsapp: string | null } | undefined
      return { email: (p?.email ?? '').toLowerCase() || null, phones: [last10(p?.phone_number ?? null), last10(p?.whatsapp ?? null)].filter(Boolean) }
    }
    const share = (a: string, b: string) => {
      const x = facts(a)
      const y = facts(b)
      return { sameEmail: !!x.email && x.email === y.email, sameMobile: x.phones.some((p) => y.phones.includes(p)), aHasMobile: x.phones.length > 0 }
    }
    console.log('aqsa tutor A vs B', share(IDS.aqsaTutorA, IDS.aqsaTutorB))
    console.log('aqsa tutor A vs staff', share(IDS.aqsaTutorA, IDS.aqsaStaff))
    console.log('aqsa tutor B vs staff', share(IDS.aqsaTutorB, IDS.aqsaStaff))
    console.log('javeria tutor vs staff', share(IDS.javeriaTutor, IDS.javeriaStaff))
    const a = await c.query(`select action, count(*) n from admin_audit_log where target_id = any($1) and action like 'staff.%' group by 1`, [
      [IDS.javeriaTutor, IDS.aqsaTutorA, IDS.aqsaTutorB],
    ])
    console.log('staff audit rows on member accounts', a.rows)
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
