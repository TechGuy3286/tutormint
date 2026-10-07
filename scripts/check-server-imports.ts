// scripts/check-server-imports.ts — `npm run check:server-imports` (CI gate).
//
// Fails when SERVER code can reach a browser-only FUNCTION module (hotfix,
// 7 Oct 2026). Since bb07fbd (6 Oct) lib/supabase/clientLazy.ts is marked
// 'use client'; lib/taxonomy.ts imports it, and three API routes that called
// labelsForMasterIds() threw at runtime:
//   "Attempted to call getBrowserClient() from the server but getBrowserClient
//    is on the client."
// tsc and `next build` both pass on that — the bundler turns the import into a
// client reference that only explodes when CALLED — so this static check exists.
//
// How: walk the import graph from every server entry (app/**/route|page|layout|
// …, proxy.ts, instrumentation.ts) through modules WITHOUT 'use client'. A
// 'use client' .tsx module is a client COMPONENT — a legitimate render boundary,
// the walk stops there. A 'use client' .ts module is functions/hooks: reaching
// one from the server is the bug, and the chain is printed. `import type` is
// erased at compile time and ignored.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative, sep } from 'node:path'

const ROOT = resolve(__dirname, '..')
const SERVER_ENTRY = /^(route|page|layout|template|not-found|loading|default|sitemap|robots|manifest|opengraph-image|twitter-image|icon|apple-icon)\.(ts|tsx)$/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const srcCache = new Map<string, string>()
const src = (f: string) => {
  if (!srcCache.has(f)) srcCache.set(f, readFileSync(f, 'utf8'))
  return srcCache.get(f)!
}
const isClient = (f: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*\s*['"]use client['"]/.test(src(f))

function resolveImport(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(ROOT, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec)
  else return null // a package
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return null
}

function importsOf(f: string): string[] {
  const s = src(f)
  const out: string[] = []
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m[2]) continue // import type … / export type …
    const r = resolveImport(f, m[3])
    if (r) out.push(r)
  }
  // dynamic import('…') in server code runs on the server too
  for (const d of s.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const r = resolveImport(f, d[1])
    if (r) out.push(r)
  }
  return out
}

export function findViolations(): { entry: string; chain: string[] }[] {
  const entries = walk(join(ROOT, 'app'))
    .filter((f) => SERVER_ENTRY.test(f.split(sep).pop()!) && !isClient(f))
  for (const extra of ['proxy.ts', 'instrumentation.ts']) {
    const p = join(ROOT, extra)
    if (existsSync(p)) entries.push(p)
  }
  const bad: { entry: string; chain: string[] }[] = []
  const reported = new Set<string>()
  for (const entry of entries) {
    const seen = new Set<string>([entry])
    const stack: { f: string; chain: string[] }[] = [{ f: entry, chain: [entry] }]
    while (stack.length) {
      const { f, chain } = stack.pop()!
      for (const dep of importsOf(f)) {
        if (seen.has(dep)) continue
        seen.add(dep)
        const next = [...chain, dep]
        if (isClient(dep)) {
          if (dep.endsWith('.ts')) {
            const key = `${entry}→${dep}`
            if (!reported.has(key)) { reported.add(key); bad.push({ entry, chain: next }) }
          }
          continue // a client component (.tsx) is a render boundary
        }
        stack.push({ f: dep, chain: next })
      }
    }
  }
  return bad
}

if (require.main === module) {
  const bad = findViolations()
  if (bad.length === 0) {
    console.log('PASS — no server code reaches a browser-only (\'use client\') .ts module.')
  } else {
    console.error(`FAIL — ${bad.length} server import chain(s) reach a browser-only module:`)
    for (const b of bad) console.error('  ' + b.chain.map((p) => relative(ROOT, p).split(sep).join('/')).join(' → '))
    process.exit(1)
  }
}
