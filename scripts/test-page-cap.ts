// npm run test:pagecap — the 1,000-row cap (owner, 8 Oct 2026). Fails if a
// whole-list read can be cut at 1,000 rows.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pageAll, pageAllIn } from '../lib/pageAll'

// A fake PostgREST that enforces max-rows = 1000, like the real one.
function fakeTable(n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i + 1 }))
  return (from: number, to: number) => Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null })
}

test('pageAll reads a 2,500-row table in full (a plain select would stop at 1,000)', async () => {
  const all = await pageAll(fakeTable(2500))
  assert.equal(all.length, 2500)
  assert.equal(all[2499].id, 2500)
})

test('pageAll stops on an exact multiple of 1,000', async () => {
  assert.equal((await pageAll(fakeTable(2000))).length, 2000)
})

test('pageAllIn pages EVERY chunk (600 ids × 7 rows each = 4,200 rows)', async () => {
  const ids = Array.from({ length: 600 }, (_, i) => i)
  const rowsFor = (part: number[]) => part.flatMap((id) => Array.from({ length: 7 }, (_, k) => ({ id, k })))
  const out = await pageAllIn(ids, (part, from, to) => Promise.resolve({ data: rowsFor(part).slice(from, Math.min(to + 1, from + 1000)), error: null }))
  assert.equal(out.length, 4200)
})

test('the known whole-list readers use the paged helper', () => {
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8')
  const mustPage: [string, RegExp][] = [
    ['lib/landing.ts', /readLandingCombinations[\s\S]*pageAll/],
    ['lib/jobFeed.ts', /nearbyCitiesWithTuitions[\s\S]{0,600}pageAll/],
    ['app/sitemap.ts', /pageAll\(\(from, to\) => supabase\.rpc\('indexable_job_slugs'\)/],
    ['lib/tuitionPause.ts', /pageAll\(/],
    ['lib/phoneAccount.ts', /pageAll\(/],
    ['lib/videoCleanup.ts', /pageAll\(/],
    ['lib/finance.ts', /pageAll\(/],
  ]
  for (const [f, re] of mustPage) assert.match(read(f), re, `${f} must read its whole list through pageAll`)
})

test('no .limit() above 1,000 anywhere (PostgREST caps it silently)', () => {
  const bad: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(e.name)) {
        const src = fs.readFileSync(p, 'utf8')
        for (const m of src.matchAll(/\.limit\((\d+)\)/g)) if (Number(m[1]) > 1000) bad.push(`${p}: .limit(${m[1]})`)
      }
    }
  }
  walk(path.join(process.cwd(), 'lib'))
  walk(path.join(process.cwd(), 'app'))
  assert.deepEqual(bad, [])
})
