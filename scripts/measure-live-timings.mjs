// scripts/measure-live-timings.mjs — read-only timing of live routes (hotfix, 26 Oct 2026).
//   node scripts/measure-live-timings.mjs [runs=12]
// Each URL is fetched `runs` times one after another (no redirects followed);
// prints status, p50 and p95 of the time to the full response, in ms.
const runs = Number(process.argv[2] ?? 12)
const base = 'https://www.tutormint.org'
const paths = [
  '/',
  '/sitemap.xml',
  '/membership-plans',
  '/browse/tutors',
  '/browse/tuitions',
  '/tuition-jobs/lahore',
  '/tutor/abdul-ahad-khan-tutor',
  '/admin',
  '/tutor/dashboard',
  '/pay/choose',
]
const ua = { 'user-agent': 'TutorMint-SEO-audit timing' }
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]
for (const p of paths) {
  const t = []
  let status = 0
  let loc = ''
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    const r = await fetch(base + p, { redirect: 'manual', headers: ua, signal: AbortSignal.timeout(60000) })
    await r.arrayBuffer()
    t.push(performance.now() - t0)
    status = r.status
    loc = r.headers.get('location') ?? ''
  }
  console.log(`${p.padEnd(26)} ${status} p50 ${pct(t, 50).toFixed(0).padStart(5)} ms  p95 ${pct(t, 95).toFixed(0).padStart(5)} ms${loc ? `  → ${loc}` : ''}`)
}
