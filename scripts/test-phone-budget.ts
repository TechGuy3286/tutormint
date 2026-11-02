/**
 * scripts/test-phone-budget.ts — npm run test:phonebudget (needs `npm run build`)
 *
 * Push 2 of 2 Nov 2026 (owner): the JavaScript a phone downloads before each
 * public page can respond stays inside its budget, and Node's crypto polyfill
 * never reaches a public page again. Reads the build's own manifests and the
 * chunk files; gzip sizes. Also pins the code changes that keep it small.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'
import { createRequire } from 'node:module'

import { BUDGET_PAGES, FORBIDDEN_MARKERS, PAGE_JS_BUDGET_KB, pageChunks, overBudget } from '../lib/pageBudgetCore'
import { queryTwinPath } from '../lib/queryTwinCore'

const NEXT = '.next'
const built = existsSync(join(NEXT, 'build-manifest.json'))
const require = createRequire(import.meta.url)
const read = (p: string) => readFileSync(p, 'utf8')

function entryFiles(manifest: string): Record<string, string[]> {
  const file = join(process.cwd(), NEXT, 'server', 'app', `${manifest}_client-reference-manifest.js`)
  const g = globalThis as unknown as { self?: unknown; __RSC_MANIFEST?: Record<string, { entryJSFiles: Record<string, string[]> }> }
  g.self = globalThis
  g.__RSC_MANIFEST = {}
  delete require.cache[require.resolve(file)]
  require(file)
  const key = Object.keys(g.__RSC_MANIFEST)[0]
  return g.__RSC_MANIFEST[key].entryJSFiles
}

test('every public page stays inside its phone JavaScript budget', { skip: !built && 'run npm run build first' }, () => {
  const root = (JSON.parse(read(join(NEXT, 'build-manifest.json'))) as { rootMainFiles: string[] }).rootMainFiles
  const lines: string[] = []
  for (const p of BUDGET_PAGES) {
    const files = pageChunks(root, entryFiles(p.manifest))
    let gz = 0
    for (const f of files) {
      const src = readFileSync(join(NEXT, f))
      gz += gzipSync(src).length
      const text = src.toString('utf8')
      for (const m of FORBIDDEN_MARKERS) assert.ok(!text.includes(m), `${p.name} loads ${f}, which contains Node's crypto polyfill ("${m}")`)
    }
    const kb = Math.round(gz / 1024)
    lines.push(`${p.name}: ${kb} KB`)
    assert.ok(!overBudget(kb), `${p.name} loads ${kb} KB of JavaScript (budget ${PAGE_JS_BUDGET_KB} KB)`)
  }
  console.log(lines.join(' · '))
})

test('the heavy shared parts load only when needed', () => {
  assert.match(read('components/upgrade/UpgradeProvider.tsx'), /dynamic\(\(\) => import\('\.\/UpgradeSheet'\), \{ ssr: false \}\)/)
  const bits = read('components/session/SessionChromeBits.tsx')
  assert.match(bits, /dynamic\(\(\) => import\('@\/components\/messages\/MessagesDock'\)/)
  assert.match(bits, /dynamic\(\(\) => import\('@\/components\/ViewAsBanner'\)/)
  const nav = read('components/Navbar.tsx')
  for (const c of ['notifications/NotificationBell', 'UserMenu', 'MemberHeader']) assert.match(nav, new RegExp(`dynamic\\(\\(\\) => import\\('@/components/${c}'\\)`))
  assert.match(nav, /loading: slot\(/, 'a sized placeholder holds the header row')
  assert.ok(!read('components/ViewAsBanner.tsx').includes('viewAsCore'), 'the banner never imports the crypto-using core')
  assert.ok(!/^import /m.test(read('lib/viewAsPaths.ts')), 'imports nothing')
})

test('Browse: only the bare page for a signed-out visitor is cached', () => {
  const none = new URLSearchParams()
  assert.equal(queryTwinPath('/browse/tutors', none, false), null)
  assert.equal(queryTwinPath('/browse/tuitions', none, false), null)
  assert.equal(queryTwinPath('/browse/tutors', none, true), '/qs/browse/tutors', 'a sign-in cookie goes live')
  assert.equal(queryTwinPath('/browse/tuitions', new URLSearchParams('city=Lahore'), false), '/qs/browse/tuitions', 'a filter goes live')
  assert.equal(queryTwinPath('/browse/tutors', new URLSearchParams('page=2'), false), '/qs/browse/tutors')
  assert.equal(queryTwinPath('/browse/tutors/abc', none, true), null)
  for (const k of ['tutors', 'tuitions']) {
    const page = read(`app/(site)/browse/${k}/page.tsx`)
    assert.match(page, /export const revalidate = 300/)
    assert.match(page, /sp=\{\{\}\} guest/)
    assert.ok(!/searchParams|cookies|headers\(/.test(page), 'the cached page reads no request data')
    const twin = read(`app/(site)/qs/browse/${k}/page.tsx`)
    assert.match(twin, /force-dynamic/)
    const view = read(`app/(site)/browse/${k}/${k === 'tutors' ? 'BrowseTutorsView' : 'BrowseTuitionsView'}.tsx`)
    assert.match(view, /guest \? \{ data: \{ user: null \} \} : await supabase\.auth\.getUser\(\)/)
    assert.match(view, /guest \? \(createPublicClient\(\)/)
    assert.match(view, /guest \? \(\s*<InlineAd/, 'no ad is chosen (or counted) while the cached page is built')
  }
  assert.match(read('proxy.ts'), /queryTwinPath\(request\.nextUrl\.pathname, request\.nextUrl\.searchParams, hasAuthCookie\(/)
})

test('taps answer at once', () => {
  const css = read('app/globals.css')
  assert.match(css, /:active \{\s*filter: brightness\(0\.9\);/)
  assert.match(css, /touch-action: manipulation;/)
})

test('Browse filter bars load their option lists only once the visitor touches the page', () => {
  for (const f of ['app/(site)/browse/tutors/TutorFilterBar.tsx', 'app/(site)/browse/tuitions/JobFilterBar.tsx']) {
    const s = read(f)
    assert.match(s, /const warm = useWarmOnIntent\(open \|\| hasFilter\)/, f)
    assert.match(s, /if \(!warm\) return\n\s*fetchLevels\(\)/, f)
    assert.match(s, /useJobTitles\(warm\)/, f)
    assert.doesNotMatch(s, /useCityAreas\(\)|useJobTitles\(\)/, f)
  }
  const hook = read('lib/useWarmOnIntent.ts')
  for (const e of ['pointermove', 'pointerdown', 'keydown', 'touchstart']) assert.ok(hook.includes(`'${e}'`), e)
})
