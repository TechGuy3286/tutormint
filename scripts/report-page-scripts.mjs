// scripts/report-page-scripts.mjs — READ ONLY (owner, 2 Nov 2026, push 2).
// For each page: the script files the HTML loads and their compressed size
// (what a phone downloads before the page can respond), plus the total.
//   node scripts/report-page-scripts.mjs [base] [--json out.json]
import { writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const args = process.argv.slice(2)
const base = args.find((a) => a.startsWith('http')) ?? 'https://www.tutormint.org'
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null
const pages = (process.env.PAGES ?? '/,/browse/tutors,/browse/tuitions,/tuition-jobs/lahore,/tuition-jobs/lahore/female,/post-tuition').split(',')
const cache = new Map()
async function size(url) {
  if (cache.has(url)) return cache.get(url)
  const r = await fetch(url)
  const buf = Buffer.from(await r.arrayBuffer())
  const s = { raw: buf.length, gz: gzipSync(buf).length }
  cache.set(url, s)
  return s
}
const result = {}
for (const p of pages) {
  const html = await (await fetch(base + p, { headers: { 'user-agent': 'TutorMint-SEO-audit' } })).text()
  const srcs = [...new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]))]
  const rows = []
  for (const s of srcs) rows.push({ src: s.split('/').pop(), ...(await size(new URL(s, base).toString())) })
  rows.sort((a, b) => b.gz - a.gz)
  const gz = rows.reduce((t, r) => t + r.gz, 0)
  result[p] = { scripts: rows.length, gzKb: Math.round(gz / 1024), top: rows.slice(0, 6).map((r) => `${r.src} ${Math.round(r.gz / 1024)}KB`) }
  console.log(p, rows.length, 'scripts', Math.round(gz / 1024), 'KB gz |', result[p].top.join(', '))
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(result, null, 2))
