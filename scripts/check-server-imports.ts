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

// The NAMED value imports of one import statement (types skipped). `default` /
// namespace imports are components by convention and are not returned.
function namedValueImports(f: string, dep: string): string[] {
  const s = src(f)
  const out: string[] = []
  const re = /(?:^|\n)\s*import\s+(?!type\s)(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (resolveImport(f, m[2]) !== dep) continue
    for (const part of m[1].split(',')) {
      const t = part.trim()
      if (!t || t.startsWith('type ')) continue
      out.push(t.split(/\s+as\s+/)[0].trim())
    }
  }
  return out
}

// A 'use client' .tsx module is a render boundary for COMPONENTS only. Any other
// value imported from it into server code (a constant, a helper) is a client
// reference on the server: calling it throws, and READING it gives a proxy that
// becomes undefined in the browser render. That is how MEMBER_SETTINGS_HREF
// (an object in components/MemberHeaderNav.tsx) reached <Link href={undefined}>
// and 500'd every signed-in member page on 9 Oct 2026 — tsc and next build pass.
const isComponentName = (n: string) => /^[A-Z][a-z0-9]/.test(n) || /^[A-Z]$/.test(n)

export function findValueImports(): { file: string; dep: string; names: string[] }[] {
  const entries = walk(join(ROOT, 'app'))
    .filter((f) => SERVER_ENTRY.test(f.split(sep).pop()!) && !isClient(f))
  for (const extra of ['proxy.ts', 'instrumentation.ts']) {
    const p = join(ROOT, extra)
    if (existsSync(p)) entries.push(p)
  }
  const out: { file: string; dep: string; names: string[] }[] = []
  const seen = new Set<string>(entries)
  const stack = [...entries]
  while (stack.length) {
    const f = stack.pop()!
    for (const dep of importsOf(f)) {
      if (isClient(dep)) {
        if (dep.endsWith('.tsx')) {
          const names = namedValueImports(f, dep).filter((n) => !isComponentName(n))
          if (names.length) out.push({ file: f, dep, names })
        }
        continue
      }
      if (!seen.has(dep)) { seen.add(dep); stack.push(dep) }
    }
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
  const values = findValueImports()
  if (values.length) {
    console.error(`FAIL — ${values.length} server file(s) import a non-component value from a 'use client' .tsx module:`)
    for (const v of values) {
      console.error(`  ${relative(ROOT, v.file).split(sep).join('/')} ← ${relative(ROOT, v.dep).split(sep).join('/')}: ${v.names.join(', ')}`)
    }
    process.exitCode = 1
  } else {
    console.log('PASS — no server code imports a non-component value from a \'use client\' .tsx module.')
  }
  if (bad.length === 0) {
    console.log('PASS — no server code reaches a browser-only (\'use client\') .ts module.')
  } else {
    console.error(`FAIL — ${bad.length} server import chain(s) reach a browser-only module:`)
    for (const b of bad) console.error('  ' + b.chain.map((p) => relative(ROOT, p).split(sep).join('/')).join(' → '))
    process.exit(1)
  }
}
