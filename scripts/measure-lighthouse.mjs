// scripts/measure-lighthouse.mjs — read-only Lighthouse mobile runs (owner, 28 Oct 2026).
//   node scripts/measure-lighthouse.mjs <server.json from measure-perf.mjs> <out.json>
// Runs Lighthouse 12.8.2 (mobile, simulated 4G) once per page listed in the
// server-timing file, so before and after measure the same pages. Records the
// performance score, LCP, TBT (lab stand-in for INP — real INP comes from Speed
// Insights), CLS and total script bytes.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [inFile, out] = process.argv.slice(2)
const paths = JSON.parse(readFileSync(inFile, 'utf8')).rows.map((r) => r.path)
const dir = mkdtempSync(join(tmpdir(), 'lh-'))
const rows = []
for (const p of paths) {
  const file = join(dir, `${rows.length}.json`)
  try {
    execFileSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['-y', 'lighthouse@12.8.2', `https://www.tutormint.org${p}`, '--quiet', '--only-categories=performance', '--output=json', `--output-path=${file}`, '--chrome-flags=--headless=new'],
      { stdio: 'ignore', timeout: 180000, shell: process.platform === 'win32' },
    )
    const j = JSON.parse(readFileSync(file, 'utf8'))
    const a = j.audits
    const js = (a['network-requests']?.details?.items ?? []).filter((i) => i.resourceType === 'Script').reduce((s, i) => s + (i.transferSize ?? 0), 0)
    const row = {
      path: p,
      perf: Math.round((j.categories.performance.score ?? 0) * 100),
      lcp: +(a['largest-contentful-paint'].numericValue / 1000).toFixed(1),
      tbt: Math.round(a['total-blocking-time'].numericValue),
      cls: +a['cumulative-layout-shift'].numericValue.toFixed(3),
      jsKb: Math.round(js / 1024),
    }
    rows.push(row)
    console.log(JSON.stringify(row))
  } catch (e) {
    rows.push({ path: p, error: String(e).slice(0, 120) })
    console.log(p, 'failed')
  }
}
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), rows }, null, 2))
