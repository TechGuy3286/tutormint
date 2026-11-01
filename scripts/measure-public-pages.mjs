// scripts/measure-public-pages.mjs — READ ONLY (owner, 31 Oct 2026).
// Times the public pages on the live site and shows whether the CDN served
// them from cache. Each URL is fetched `runs` times one after another (no
// redirects followed); prints status, p50, p95, and the x-vercel-cache values.
//   node scripts/measure-public-pages.mjs [runs=8] [out.json]
import { writeFileSync } from 'node:fs'

const runs = Number(process.argv[2] ?? 8)
const out = process.argv[3]
const base = 'https://www.tutormint.org'
const paths = [
  '/',
  '/sitemap.xml',
  '/browse/tuitions',
  '/browse/tutors',
  '/tuition-jobs/lahore',
  '/tuitions/lahore/a-level-english-language-literature-tutor-needed-in-lahore-08b5a6',
  '/tutor/abdul-ahad-khan-tutor',
  '/faq',
  '/blog',
  '/post-tuition',
]
const ua = { 'user-agent': 'TutorMint-SEO-audit timing' }
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]
const rows = []
for (const p of paths) {
  const t = []
  const cache = {}
  let status = 0
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    const r = await fetch(base + p, { redirect: 'manual', headers: ua, signal: AbortSignal.timeout(60000) })
    await r.arrayBuffer()
    t.push(performance.now() - t0)
    status = r.status
    const c = r.headers.get('x-vercel-cache') ?? '-'
    cache[c] = (cache[c] ?? 0) + 1
  }
  const row = { path: p, status, p50: Math.round(pct(t, 50)), p95: Math.round(pct(t, 95)), cache }
  rows.push(row)
  console.log(`${String(status)} p50 ${String(row.p50).padStart(5)} ms  p95 ${String(row.p95).padStart(5)} ms  ${JSON.stringify(cache)}  ${p}`)
}
if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), runs, rows }, null, 2))
