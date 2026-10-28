/**
 * scripts/report-job-posting-fields.ts — READ ONLY. Counts for the Job Posting
 * fields (owner, 28 Oct 2026): open tuitions by employment type, open tuitions
 * with no fee, and open tuitions whose postal code resolves (stored, or the
 * city/area lookup) vs not, with the cities that have none. Counts only.
 *
 *   npx tsx --env-file=.env.local scripts/report-job-posting-fields.ts
 */
// @ts-expect-error pg ships no bundled types
import pg from 'pg'
import { postcodeFor } from '../lib/postcodes'
import { hasFee } from '../lib/jobFieldsCore'

async function main() {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('begin read only')
  const { rows } = await c.query(`select city, area, employment_type, postal_code, budget_pkr, budget_min_pkr, budget_max_pkr from jobs where status = 'open'`)
  await c.query('rollback')
  await c.end()
  const byType: Record<string, number> = {}
  let noFee = 0, stored = 0, lookup = 0, none = 0
  const missingCities: Record<string, number> = {}
  for (const r of rows) {
    byType[r.employment_type ?? 'null'] = (byType[r.employment_type ?? 'null'] ?? 0) + 1
    if (!hasFee(r.budget_min_pkr, r.budget_max_pkr, r.budget_pkr)) noFee++
    if (r.postal_code) stored++
    else if (postcodeFor(r.city, r.area)) lookup++
    else { none++; const k = (r.city ?? '(no city)').trim(); missingCities[k] = (missingCities[k] ?? 0) + 1 }
  }
  console.log('open tuitions:', rows.length)
  console.log('by employment_type:', JSON.stringify(byType))
  console.log('open with no fee:', noFee)
  console.log('postal code: stored', stored, '· from lookup', lookup, '· none', none)
  console.log('cities with no postal code:', JSON.stringify(missingCities))
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
