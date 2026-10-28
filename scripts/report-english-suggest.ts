/**
 * scripts/report-english-suggest.ts — read-only (owner, 28 Oct 2026).
 * Search words that say "english", and what search_suggest('English') returns.
 *   npx tsx --env-file=.env.local scripts/report-english-suggest.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const a = await c.query(`select kind, slug, alias, created_at from taxonomy_aliases where alias ilike '%english%' or alias ilike 'eng%'`)
  for (const r of a.rows) console.log('alias', JSON.stringify(r))
  const args = await c.query(`select pg_get_function_arguments('public.search_suggest'::regproc) as a`)
  console.log('args:', args.rows[0].a)
  const s = await c.query(`select * from search_suggest('English') limit 20`)
  for (const r of s.rows) console.log('  ', r.grp, r.ref, r.label, '|', r.sublabel, r.score)
  await c.end()
}
void main()
