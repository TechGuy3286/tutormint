/**
 * scripts/measure-admin-loaders.ts — READ ONLY (owner, 28 Oct 2026).
 * Times the server loaders behind the admin pages (Overview, People, Applications,
 * Follow-ups, Finance, Paid tutors) against production, run from this machine
 * (so each Supabase round trip includes the Lahore↔Mumbai hop that a Vercel
 * function in bom1 does not pay). Prints p50 / p95 over a few runs and the
 * number of rows each sends. Writes nothing.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/measure-admin-loaders.ts [runs=3] [out.json]
 */
import { writeFileSync } from 'node:fs'
import { loadDirectory, loadDirectoryDocs } from '../lib/peopleDirectory'
import { loadMemberCards } from '../lib/overviewCards'
import { loadApplicationBoard } from '../lib/applicationTracking'
import { loadForwardBoard } from '../lib/applicantForwards'
import { loadTutorFollowUps } from '../lib/tutorFollowUps'
import { loadParentFollowUps } from '../lib/parentFollowUps'
import { loadFinance } from '../lib/finance'
import { loadSettlementsBoard } from '../lib/settlementMatch'
import { loadPaidTutors } from '../lib/paidTutors'
import { loadOverviewList } from '../lib/overviewItems'
import { OVERVIEW_ITEMS, type OverviewItemKey } from '../lib/overviewItemsCore'

const runs = Number(process.argv[2] ?? 3)
const out = process.argv[3]
const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]
const month = new Date().toISOString().slice(0, 7)

const pages: Record<string, () => Promise<number>> = {
  Overview: async () => {
    const keys = Object.keys(OVERVIEW_ITEMS) as OverviewItemKey[]
    const lists = await Promise.all(keys.map((k) => loadOverviewList(k, { days: 7 }).catch(() => null)))
    return lists.reduce((s, l) => s + (l?.rows.length ?? 0), 0)
  },
  People: async () => {
    const d = await loadDirectory()
    const ids = d.people.filter((p) => p.role === 'tutor' && p.excluded === null).map((p) => p.id)
    await Promise.all([loadMemberCards(ids), loadDirectoryDocs()])
    return ids.length
  },
  Applications: async () => {
    const [b] = await Promise.all([loadApplicationBoard(), loadForwardBoard()])
    return b.rows.length
  },
  'Follow-ups': async () => {
    const [t] = await Promise.all([loadTutorFollowUps('recent'), loadParentFollowUps()])
    return t.length
  },
  Finance: async () => {
    const [, s] = await Promise.all([loadFinance(), loadSettlementsBoard(month)])
    return s ? 1 : 0
  },
  'Paid tutors': async () => (await loadPaidTutors()).rows.length,
}

async function main() {
  const rows: { page: string; p50: number; p95: number; rows: number }[] = []
  const only = process.env.PAGES ? process.env.PAGES.split(",") : null
  for (const [name, fn] of Object.entries(pages)) {
    if (only && !only.includes(name)) continue
    const t: number[] = []
    let n = 0
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now()
      n = await fn()
      t.push(performance.now() - t0)
    }
    const r = { page: name, p50: Math.round(pct(t, 50)), p95: Math.round(pct(t, 95)), rows: n }
    rows.push(r)
    console.log(`${name.padEnd(14)} p50 ${String(r.p50).padStart(6)} ms  p95 ${String(r.p95).padStart(6)} ms  rows ${n}`)
  }
  if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), runs, rows }, null, 2))
  process.exit(0)
}
void main()
