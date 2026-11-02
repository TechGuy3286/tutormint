// scripts/pool-phone-runs.mjs — READ ONLY (owner, 2 Nov 2026, push 2).
// Pools every Lighthouse JSON in the given folders by page and reports the
// median of each figure (so a page measured in two sessions uses all its runs).
//   node scripts/pool-phone-runs.mjs <out.json> <dir> [dir...]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [out, ...dirs] = process.argv.slice(2)
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
const byPath = new Map()
for (const d of dirs) {
  for (const f of readdirSync(d).filter((x) => x.endsWith('.json'))) {
    let j
    try { j = JSON.parse(readFileSync(join(d, f), 'utf8')) } catch { continue }
    if (!j?.audits || j.runtimeError) continue
    const a = j.audits
    const path = new URL(j.requestedUrl).pathname
    const js = (a['network-requests']?.details?.items ?? []).filter((x) => x.resourceType === 'Script').reduce((s, x) => s + (x.transferSize ?? 0), 0)
    const r = {
      perf: Math.round((j.categories.performance.score ?? 0) * 100),
      lcp: a['largest-contentful-paint'].numericValue / 1000,
      tbt: a['total-blocking-time'].numericValue,
      cls: a['cumulative-layout-shift'].numericValue,
      jsKb: js / 1024,
      tti: (a['interactive']?.numericValue ?? 0) / 1000,
    }
    if (!byPath.has(path)) byPath.set(path, [])
    byPath.get(path).push(r)
  }
}
const rows = [...byPath].map(([path, runs]) => {
  const pick = (k) => median(runs.map((r) => r[k]))
  return { path, runs: runs.length, perf: pick('perf'), lcp: +pick('lcp').toFixed(1), tbt: Math.round(pick('tbt')), cls: +pick('cls').toFixed(3), jsKb: Math.round(pick('jsKb')), tti: +pick('tti').toFixed(1) }
})
for (const r of rows) console.log(JSON.stringify(r))
writeFileSync(out, JSON.stringify({ rows }, null, 2))
