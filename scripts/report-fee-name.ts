/**
 * scripts/report-fee-name.ts — READ-ONLY.
 * Where the retired fee name ("Spam Free Platform Fee") is still STORED in the
 * database (owner, 10 Oct 2026 — the fee is the "Verification Fee"). Counts per
 * table and column; no row content is printed beyond a title or key.
 *   npx tsx --env-file=.env.local scripts/report-fee-name.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const OLD = '%spam%free%'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows: cols } = await c.query(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public' and data_type in ('text', 'character varying', 'jsonb')
        and table_name not like 'legacy_%' order by 1, 2`,
  )
  const { rows: views } = await c.query(`select table_name from information_schema.views where table_schema = 'public'`)
  const isView = new Set(views.map((v: { table_name: string }) => v.table_name))
  for (const { table_name, column_name } of cols as { table_name: string; column_name: string }[]) {
    if (isView.has(table_name)) continue
    const { rows } = await c.query(`select count(*)::int as n from public."${table_name}" where "${column_name}"::text ilike $1`, [OLD])
    if (rows[0].n > 0) console.log(`${table_name}.${column_name}: ${rows[0].n}`)
  }
  const { rows: t } = await c.query(`select key, title from admin_message_templates where body ilike $1 or title ilike $1 or subject ilike $1`, [OLD])
  console.log('templates holding the old name:', JSON.stringify(t))
  const { rows: p } = await c.query(`select slug, status from posts where body ilike $1 or seo_title ilike $1 or seo_description ilike $1 or title ilike $1`, [OLD])
  console.log('posts holding the old name:', JSON.stringify(p))
  await c.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
