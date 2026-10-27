/**
 * scripts/report-phone-columns.ts — READ ONLY. Lists every public column whose
 * name suggests a phone / WhatsApp / mobile / contact value, with how many rows
 * hold a non-empty value. Counts only, never a value.
 *
 *   npx tsx --env-file=.env.local scripts/report-phone-columns.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
  await c.connect()
  try {
    const cols = (
      await c.query(`
        select table_name, column_name, data_type
          from information_schema.columns c
         where table_schema = 'public'
           and (column_name ~* '(phone|whatsapp|mobile|msisdn|contact)')
           and exists (select 1 from information_schema.tables t where t.table_schema='public' and t.table_name=c.table_name and t.table_type='BASE TABLE')
         order by 1, 2`)
    ).rows as { table_name: string; column_name: string; data_type: string }[]
    for (const r of cols) {
      let n = '?'
      try {
        const q = r.data_type.includes('text') || r.data_type.includes('char')
          ? `select count(*)::int n from public."${r.table_name}" where nullif(btrim("${r.column_name}"),'') is not null`
          : `select count(*)::int n from public."${r.table_name}" where "${r.column_name}" is not null`
        n = String((await c.query(q)).rows[0].n)
      } catch (e) {
        n = 'err'
      }
      console.log(`${r.table_name}.${r.column_name} (${r.data_type}): ${n}`)
    }
  } finally {
    await c.end()
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
