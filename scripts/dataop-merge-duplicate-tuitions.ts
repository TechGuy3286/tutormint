/**
 * scripts/dataop-merge-duplicate-tuitions.ts — one-time data operation (owner,
 * 6 Oct 2026, item 15): merge the repeats listed in
 * docs/duplicate-tuitions-team-2026-10-06.xlsx (sheet "Repeats").
 *
 *   npx tsx --env-file=.env.local scripts/dataop-merge-duplicate-tuitions.ts            # plan only (read-only)
 *   npx tsx --env-file=.env.local scripts/dataop-merge-duplicate-tuitions.ts --apply    # merge via production
 *
 * WHAT IT DECIDES LOCALLY (read-only pg): for each (repeat, original) pair —
 * the current facts of both, lib/duplicatesCore.shouldMerge (merge on the same
 * title, or on the same full combination when the titles describe the same
 * job; skip and list a combination-only pair whose job titles differ), and the
 * repeat's application count (a repeat with applications is skipped).
 *
 * WHAT PRODUCTION DOES (POST /api/internal/merge-duplicates, CRON_SECRET): the
 * survivor (more Search Console impressions over 90 days; oldest when Search
 * Console is unavailable or both are 0) and lib/tuitionMerge.mergeTuition:
 * repeat closed + merged_into (its URL 301s), Indexing API URL_DELETED,
 * survivor refreshed (fresh 15 days, URL_UPDATED), audit row. Nothing deleted.
 */

// @ts-expect-error pg ships no bundled types; dev-only data-op script.
import pg from 'pg'
import ExcelJS from 'exceljs'
import { shouldMerge, type DuplicateFacts } from '../lib/duplicatesCore'

const XLSX = 'docs/duplicate-tuitions-team-2026-10-06.xlsx'
const ROUTE = 'https://www.tutormint.org/api/internal/merge-duplicates'

type Pair = { repeatRef: string; originalRef: string; why: string }

async function readPairs(): Promise<Pair[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(XLSX)
  const ws = wb.getWorksheet('Repeats')
  if (!ws) throw new Error('no Repeats sheet')
  const out: Pair[] = []
  ws.eachRow((row, n) => {
    if (n === 1) return
    const v = row.values as unknown[]
    const cell = (i: number) => {
      const x = v[i]
      return typeof x === 'object' && x && 'text' in (x as object) ? String((x as { text: string }).text) : String(x ?? '')
    }
    const repeatRef = cell(2).trim()
    const originalRef = cell(6).trim()
    const why = cell(9).trim()
    if (repeatRef && originalRef) out.push({ repeatRef, originalRef, why })
  })
  return out
}

async function main() {
  const apply = process.argv.includes('--apply')
  const pairs = await readPairs()
  console.log(`Pairs in the sheet: ${pairs.length}`)

  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  const refs = [...new Set(pairs.flatMap((p) => [p.repeatRef, p.originalRef]))]
  const { rows } = await c.query(
    `select j.id, j.ref_id, j.title, j.city, j.area, j.class_levels, j.class_level, j.gender_preference, j.budget_pkr, j.budget_min_pkr, j.budget_max_pkr,
            j.status, j.created_at::text as created_at, j.merged_into,
            coalesce((select array_agg(js.master_id order by js.master_id) from job_subjects js where js.job_id = j.id), '{}') as masters,
            (select count(*)::int from applications a where a.job_id = j.id) as applications
       from jobs j where j.ref_id = any($1)`,
    [refs],
  )
  await c.end()
  const byRef = new Map<string, (typeof rows)[number]>(rows.map((r: { ref_id: string }) => [r.ref_id, r]))
  const facts = (r: (typeof rows)[number]): DuplicateFacts => ({
    id: r.id,
    title: r.title,
    city: r.city,
    area: r.area,
    classLevels: r.class_levels,
    classLevel: r.class_level,
    masterIds: r.masters ?? [],
    genderPreference: r.gender_preference,
    budgetPkr: r.budget_pkr,
    budgetMinPkr: r.budget_min_pkr,
    budgetMaxPkr: r.budget_max_pkr,
    createdAt: r.created_at,
  })

  const toMerge: { repeatRef: string; originalRef: string; reason: string }[] = []
  const skipped: { repeatRef: string; originalRef: string; why: string }[] = []
  for (const p of pairs) {
    const r = byRef.get(p.repeatRef)
    const o = byRef.get(p.originalRef)
    if (!r || !o) {
      skipped.push({ ...p, why: 'not found' })
      continue
    }
    if (r.merged_into || o.merged_into) {
      skipped.push({ ...p, why: 'already merged' })
      continue
    }
    if (!['open', 'paused'].includes(r.status)) {
      skipped.push({ ...p, why: `repeat is ${r.status}` })
      continue
    }
    if (r.applications > 0) {
      skipped.push({ ...p, why: `repeat has ${r.applications} application(s)` })
      continue
    }
    const d = shouldMerge(facts(r), facts(o))
    if (!d.merge) {
      skipped.push({ ...p, why: d.skipWhy ?? 'not a repeat' })
      continue
    }
    toMerge.push({ repeatRef: p.repeatRef, originalRef: p.originalRef, reason: d.reasons.join(' + ') })
  }

  console.log(`\nTo merge: ${toMerge.length}`)
  for (const m of toMerge) console.log(`  ${m.repeatRef} → ${m.originalRef}  (${m.reason})`)
  console.log(`\nSkipped: ${skipped.length}`)
  for (const s of skipped) console.log(`  ${s.repeatRef} vs ${s.originalRef}: ${s.why}`)

  if (toMerge.length === 0) return
  const secret = process.env.CRON_SECRET
  if (!secret) throw new Error('CRON_SECRET missing')
  const post = async (dryRun: boolean) => {
    const res = await fetch(ROUTE, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ dryRun, pairs: toMerge }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json).slice(0, 300)}`)
    return json as { searchConsole: string; results: Record<string, unknown>[] }
  }
  console.log(`\n${apply ? 'APPLYING' : 'Dry run'} on production…`)
  const out = await post(!apply)
  console.log('Search Console:', out.searchConsole)
  for (const r of out.results) console.log(' ', JSON.stringify(r))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
