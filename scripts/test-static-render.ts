/**
 * scripts/test-static-render.ts — npm run test:staticrender
 *
 * Hotfix (owner, 1 Nov 2026): nothing during a cached (ISR) page build may read
 * request headers or write to the database. Push 3 made public pages cached; the
 * in-memory cache's 5-minute counter save wrote to admin_summary from inside page
 * renders, and the server Supabase fetch read headers() to check "View as" — so
 * first renders answered 500 ("Page changed from static to dynamic at runtime").
 *
 * Unit + source checks here (no DB, network or build). The end-to-end check —
 * a production build served locally, every cached page loaded fresh, the
 * server log scanned — is scripts/test-static-render-live.mjs
 * (npm run test:staticrender:live).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'

// A Next server sets this global before its modules load; do the same here.
;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { workUnitAsyncStorage } = require('next/dist/server/app-render/work-unit-async-storage.external') as typeof import('next/dist/server/app-render/work-unit-async-storage.external')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { guardStaticWrites, renderPhase, STATIC_WRITE_MESSAGE } = require('../lib/supabase/fetch') as typeof import('../lib/supabase/fetch')

const read = (p: string) => readFileSync(p, 'utf8')
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const BASE = 'https://x.supabase.co'
type Call = { url: string; method: string }

function fakeFetch(calls: Call[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: (init?.method ?? 'GET').toUpperCase() })
    return new Response('[]', { status: 200 })
  }) as typeof fetch
}

// Run fn inside a fake Next work unit of the given type.
function inStore<T>(type: string, fn: () => T): T {
  return workUnitAsyncStorage.run({ type, phase: 'render' } as never, fn)
}

test('renderPhase: a live request, a cached page build, and outside Next', () => {
  assert.equal(renderPhase(), 'none')
  assert.equal(inStore('request', renderPhase), 'request')
  for (const t of ['prerender-legacy', 'prerender', 'prerender-ppr', 'generate-static-params', 'cache']) {
    assert.equal(inStore(t, renderPhase), 'static', t)
  }
})

test('a write while a cached page is built is refused and never reaches Supabase', async () => {
  const calls: Call[] = []
  const f = guardStaticWrites(fakeFetch(calls))
  const writes: [string, string][] = [
    ['POST', `${BASE}/rest/v1/admin_summary`],
    ['PATCH', `${BASE}/rest/v1/jobs?id=eq.1`],
    ['DELETE', `${BASE}/rest/v1/jobs?id=eq.1`],
    ['POST', `${BASE}/rest/v1/rpc/bump_site_visit`],
    ['POST', `${BASE}/storage/v1/object/avatars/a.png`],
  ]
  for (const [method, url] of writes) {
    const res = await inStore('prerender-legacy', () => f(url, { method }))
    assert.equal(res.status, 403, `${method} ${url}`)
    assert.equal((await res.json()).message, STATIC_WRITE_MESSAGE)
  }
  assert.equal(calls.length, 0)
})

test('reads still work while a cached page is built; writes still work in a live request', async () => {
  const calls: Call[] = []
  const f = guardStaticWrites(fakeFetch(calls))
  await inStore('prerender-legacy', () => f(`${BASE}/rest/v1/jobs?select=*`))
  await inStore('prerender-legacy', () => f(`${BASE}/rest/v1/rpc/rank_tutors`, { method: 'POST' }))
  await inStore('prerender-legacy', () => f(`${BASE}/rest/v1/rpc/tutor_public_page`, { method: 'POST' }))
  await inStore('request', () => f(`${BASE}/rest/v1/jobs`, { method: 'POST' }))
  await f(`${BASE}/rest/v1/jobs`, { method: 'POST' }) // scripts / cron outside Next
  assert.equal(calls.length, 5)
})

test('the View-as check reads headers() only inside a live request', () => {
  const src = code('lib/supabase/fetch.ts')
  const fn = src.slice(src.indexOf('async function requestIsViewAs'), src.indexOf('export const STATIC_WRITE_MESSAGE'))
  assert.match(fn, /if \(renderPhase\(\) !== 'request'\) return false\s*try \{\s*const \{ headers \}/)
  assert.match(src, /export const supabaseFetch: FetchFn = guardStaticWrites\(guardFetch\(makeSupabaseFetch\(\), requestIsViewAs\)\)/)
})

test('the in-memory cache never writes anywhere', () => {
  const src = code('lib/memoCache.ts')
  assert.doesNotMatch(src, /supabase|createAdminClient|\.upsert\(|\.insert\(|\.update\(|fetch\(|next\/headers/)
})

// Every cached page and the files it renders through: no direct request read
// and no cookie-scoped client. (Indirect reads are caught by the guard above
// and by the live test.)
function cachedPageFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name === 'page.tsx' && /export const revalidate\s*=/.test(read(p))) out.push(p)
    }
  }
  walk('app')
  return out
}

test('cached pages read no request headers, cookies or search params', () => {
  const pages = cachedPageFiles()
  assert.ok(pages.length >= 14, `found ${pages.length} cached pages`)
  for (const page of pages) {
    const dir = page.slice(0, -'page.tsx'.length)
    const files = [page, ...['render.tsx', 'profile.tsx', 'not-found.tsx', 'BlogIndex.tsx'].map((f) => dir + f).filter(existsSync)]
    for (const f of files) {
      const src = code(f)
      assert.doesNotMatch(src, /from 'next\/headers'|import\('next\/headers'\)/, `${f} imports next/headers`)
      assert.doesNotMatch(src, /from '@\/lib\/supabase\/server'/, `${f} uses the cookie-scoped client`)
      assert.doesNotMatch(src, /\bsearchParams\b/, `${f} reads search params`)
      assert.doesNotMatch(src, /getSessionUser\(/, `${f} reads the session`)
    }
  }
})

test('the live check exists and fails on header reads, refused writes and 500s', () => {
  const live = read('scripts/test-static-render-live.mjs')
  assert.match(live, /static to dynamic/)
  assert.match(live, /DYNAMIC_SERVER_USAGE/)
  assert.match(live, /\[static-write\]/)
  assert.match(read('package.json'), /"test:staticrender:live": "node scripts\/test-static-render-live\.mjs"/)
})

test('a missing tutor address looks up its old slug without the cookie client', () => {
  const src = code('lib/tutorSlug.ts')
  const fn = src.slice(src.indexOf('export async function currentSlugForRetired'), src.indexOf('export async function suggestSlug'))
  assert.match(fn, /createPublicClient\(\)/)
  assert.doesNotMatch(src, /from '@\/lib\/supabase\/server'/)
})
