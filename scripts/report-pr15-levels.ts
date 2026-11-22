/**
 * scripts/report-pr15-levels.ts — READ-ONLY (PR-15). Lists the taxonomy
 * category and level names (no member data) to design the profile's level
 * labels and grade grouping.
 *   npx tsx --env-file=.env.local scripts/report-pr15-levels.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const r = await c.query(
    `select c.name cat, c.sort_order cs, l.name lvl, l.title_name tn, l.sort_order ls, l.legacy
       from taxonomy_levels l join taxonomy_categories c on c.slug = l.category_slug
      order by c.sort_order, l.sort_order`,
  )
  for (const x of r.rows) console.log([x.cs, x.cat, '|', x.ls, x.lvl, '|', x.tn ?? '', x.legacy ? 'LEGACY' : ''].join(' '))
  await c.end()
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
