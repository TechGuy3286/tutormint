// scripts/measure-phone.mjs — READ ONLY (owner, 2 Nov 2026, push 2 Part A).
// Lighthouse 12.8.2 mobile defaults = an emulated mid-range Android (Moto G
// Power, 4× CPU slowdown) on simulated 4G. Three runs per page; the median of
// each figure is reported. Records the performance score, LCP, TBT (the lab
// stand-in for INP), CLS, total script KB and Time to Interactive (when the
// first tap works).
//   node scripts/measure-phone.mjs <out.json> [base]
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2]
const base = process.argv[3] ?? 'https://www.tutormint.org'
const PAGES = [
  ['Homepage', '/'],
  ['Browse tutors', '/browse/tutors'],
  ['Browse tuitions', '/browse/tuitions'],
  ['Tuition page', process.env.TUITION_PATH],
  ['Tutor profile', process.env.TUTOR_PATH],
  ['City tuition page', '/tuition-jobs/lahore'],
  ['Female jobs page', '/tuition-jobs/lahore/female'],
  ['Post a tuition', '/post-tuition'],
].filter(([n, p]) => p && (!process.env.ONLY || new RegExp(`^(${process.env.ONLY})$`).test(n)))
const RUNS = Number(process.env.RUNS ?? 3)
const dir = mkdtempSync(join(tmpdir(), 'lhp-'))
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
const rows = []
for (const [name, p] of PAGES) {
  const runs = []
  for (let i = 0; i < RUNS; i++) {
    const file = join(dir, `${rows.length}-${i}.json`)
    try {
      execFileSync(
        process.platform === 'win32' ? 'npx.cmd' : 'npx',
        ['-y', 'lighthouse@12.8.2', `${base}${p}`, '--quiet', '--only-categories=performance', '--output=json', `--output-path=${file}`, '--chrome-flags=--headless=new'],
        { stdio: 'ignore', timeout: 240000, shell: process.platform === 'win32' },
      )
      const j = JSON.parse(readFileSync(file, 'utf8'))
      const a = j.audits
      const js = (a['network-requests']?.details?.items ?? []).filter((x) => x.resourceType === 'Script').reduce((s, x) => s + (x.transferSize ?? 0), 0)
      runs.push({
        perf: Math.round((j.categories.performance.score ?? 0) * 100),
        lcp: a['largest-contentful-paint'].numericValue / 1000,
        tbt: a['total-blocking-time'].numericValue,
        cls: a['cumulative-layout-shift'].numericValue,
        jsKb: js / 1024,
        tti: (a['interactive']?.numericValue ?? 0) / 1000,
      })
    } catch (e) {
      console.log(name, 'run failed', String(e).slice(0, 100))
    }
  }
  if (!runs.length) { rows.push({ name, path: p, error: 'all runs failed' }); continue }
  const pick = (k) => median(runs.map((r) => r[k]))
  const row = {
    name,
    path: p,
    runs: runs.length,
    perf: pick('perf'),
    lcp: +pick('lcp').toFixed(1),
    tbt: Math.round(pick('tbt')),
    cls: +pick('cls').toFixed(3),
    jsKb: Math.round(pick('jsKb')),
    tti: +pick('tti').toFixed(1),
  }
  rows.push(row)
  console.log(JSON.stringify(row))
}
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), base, rows }, null, 2))
