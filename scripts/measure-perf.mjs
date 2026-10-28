// scripts/measure-perf.mjs — read-only timing of live public pages (owner, 28 Oct 2026).
//   node scripts/measure-perf.mjs [runs=10] [out.json]
// Each URL is fetched `runs` times one after another (no redirects followed);
// records the time to first byte and to the full response; prints p50 / p95.
// The tuition and tutor pages are taken from the live sitemaps, so the same
// pages are measured before and after a change (their paths are printed).
import { writeFileSync } from 'node:fs'

const runs = Number(process.argv[2] ?? 10)
const out = process.argv[3]
const base = 'https://www.tutormint.org'
const ua = { 'user-agent': 'TutorMint-SEO-audit timing' }
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]

async function firstLoc(sitemap, match) {
  const xml = await (await fetch(base + sitemap, { headers: ua })).text()
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => match.test(u))
  return new URL(locs[0]).pathname
}

const tuition = process.env.PERF_TUITION || (await firstLoc('/sitemap-tuitions.xml', /\/tuitions\/lahore\//))
const tutor = process.env.PERF_TUTOR || (await firstLoc('/sitemap-tutors.xml', /\/tutor\//))
const paths = ['/', '/browse/tuitions', '/browse/tutors', tuition, tutor, '/tuition-jobs/lahore/female', '/pay/choose']
const rows = []
for (const p of paths) {
  const ttfb = []
  const full = []
  let status = 0
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    const r = await fetch(base + p, { redirect: 'manual', headers: ua, signal: AbortSignal.timeout(60000) })
    ttfb.push(performance.now() - t0)
    await r.arrayBuffer()
    full.push(performance.now() - t0)
    status = r.status
  }
  const row = { path: p, status, ttfb50: Math.round(pct(ttfb, 50)), ttfb95: Math.round(pct(ttfb, 95)), full50: Math.round(pct(full, 50)), full95: Math.round(pct(full, 95)) }
  rows.push(row)
  console.log(`${p.slice(0, 60).padEnd(60)} ${status}  TTFB p50 ${String(row.ttfb50).padStart(5)} p95 ${String(row.ttfb95).padStart(5)}  full p50 ${String(row.full50).padStart(5)} p95 ${String(row.full95).padStart(5)} ms`)
}
if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), runs, rows }, null, 2))
