/**
 * scripts/report-unmet-rerun.ts — READ ONLY (owner, 28 Oct 2026).
 * Runs every unmet search of the last 7 days again through the live search
 * (lib/unmetSearches rerunSearch — the same dictionary, parser and list loaders
 * the browse pages use) and prints how many tutors / tuitions each finds now.
 * Writes nothing.
 *   npx tsx --import ./scripts/stubs/guest-register.mjs --conditions=react-server --env-file=.env.local scripts/report-unmet-rerun.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { rerunSearch } from '../lib/unmetSearches'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const { rows } = await c.query(`select distinct on (lower(query), surface) query, surface from search_unmet where created_at > now() - interval '7 days' order by lower(query), surface`)
  await c.end()
  let fixed = 0
  for (const r of rows as { query: string; surface: string }[]) {
    const now = await rerunSearch(r.query).catch((e: unknown) => { console.log(String(e).slice(0, 300)); return { tutors: -1, tuitions: -1, understood: false } })
    const hit = r.surface === 'tutors' ? now.tutors : now.tuitions
    if (hit > 0) fixed++
    console.log(`${hit > 0 ? 'FOUND ' : 'none  '} [${r.surface}] "${r.query}" → tutors ${now.tutors}, tuitions ${now.tuitions}${now.understood ? '' : ' (not understood)'}`)
  }
  console.log(`\n${fixed} of ${rows.length} distinct searches now find results on the page they were made on.`)
  process.exit(0)
}
void main()
