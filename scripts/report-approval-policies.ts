/**
 * scripts/report-approval-policies.ts — READ ONLY. Lists the write policies on
 * the tables that hold approval state, and the approval columns on profiles,
 * so the Owner-only approvals guard (migration 176) covers every direct path.
 *   npx tsx --env-file=.env.local scripts/report-approval-policies.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const pol = await c.query(
    `select tablename, policyname, cmd, roles::text, coalesce(qual,'') as qual, coalesce(with_check,'') as wc
       from pg_policies
      where schemaname = 'public'
        and tablename in ('profiles','tutor_profiles','user_documents','payments','staff_signup_claims','avatar_rotations','document_unlocks')
        and cmd in ('UPDATE','ALL','INSERT','DELETE')
      order by tablename, policyname`,
  )
  for (const r of pol.rows) console.log(`${r.tablename} | ${r.policyname} | ${r.cmd} | ${r.roles}\n    using: ${r.qual}\n    check: ${r.wc}`)
  const cols = await c.query(
    `select table_name, column_name from information_schema.columns
      where table_schema='public' and table_name in ('profiles','tutor_profiles','user_documents','payments')
        and (column_name ~ '(status|verified_at|reviewed|reason|state|rotation|cnic_number|rereview)')
      order by 1, 2`,
  )
  console.log(cols.rows.map((r: { table_name: string; column_name: string }) => `${r.table_name}.${r.column_name}`).join('\n'))
  const trg = await c.query(
    `select event_object_table as t, trigger_name from information_schema.triggers
      where trigger_schema='public' and event_object_table in ('profiles','tutor_profiles','user_documents','payments') order by 1,2`,
  )
  console.log(trg.rows.map((r: { t: string; trigger_name: string }) => `trigger ${r.t}.${r.trigger_name}`).join('\n'))
  await c.end()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
