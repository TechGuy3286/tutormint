/**
 * scripts/test-push3.ts — npm run test:push3
 *
 * Push 3 of "Fast admin, Number first, cost and email clean-up" (owner, 1 Nov 2026):
 * cached public pages (no cookie read on the server, rebuilt on change), the
 * signed-in header and viewer parts drawn in the browser, query twins, the
 * in-memory cache that replaced unstable_cache, and the cheaper summary job.
 * Pure rules + source scans (+ the build's prerender manifest when present);
 * no DB, browser or network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { hasAuthCookie, dashboardHrefFor, emptyNotificationsFor } from '../lib/headerSessionCore'
import { queryTwinPath } from '../lib/queryTwinCore'
import { showApplyForViewer } from '../lib/tuitionViewerCore'
import { ownPreviewPath, showProfileActions } from '../lib/tutorViewerCore'
import { showApplyFor, viewerJobIds } from '../lib/viewerJobsCore'
import { addRunToTally, MIN_DIRTY_GAP_MS, needsRebuild } from '../lib/adminSummaryCore'
import { invalidateMemoTag, memoize, memoTallyForTests } from '../lib/memoCache'
import { inRunMemo, runMemo, withRunMemo } from '../lib/runMemo'

const read = (p: string) => readFileSync(p, 'utf8')
/** The file without its comments — scans look at code, not at notes about it. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const P = (s: string) => new URLSearchParams(s)

// ------------------------------------------------------------ session ---

test('header: a guest is known from the cookies alone (no request)', () => {
  assert.equal(hasAuthCookie(''), false)
  assert.equal(hasAuthCookie(null), false)
  assert.equal(hasAuthCookie('tm_anon=abc; tm_utm=x'), false)
  assert.equal(hasAuthCookie('sb-abcd-auth-token=base64-xyz'), true)
  assert.equal(hasAuthCookie('tm_anon=1; sb-abcd-auth-token.0=part'), true)
  assert.equal(hasAuthCookie('sb-abcd-auth-token='), false, 'an emptied cookie is signed out')
})

test('header: the same words and links as the server header had', () => {
  assert.equal(dashboardHrefFor('tutor'), '/tutor/dashboard')
  assert.equal(dashboardHrefFor('parent'), '/parent/dashboard')
  assert.equal(dashboardHrefFor('admin'), '/admin')
  for (const r of ['tutor', 'parent', 'admin'] as const) assert.ok(emptyNotificationsFor(r).hint.length > 0)
})

test('header: the signed-in parts are client-side; the chrome reads no session on the server', () => {
  for (const f of ['components/SiteChrome.tsx', 'components/Navbar.tsx', 'components/Footer.tsx', 'app/(site)/layout.tsx', 'app/layout.tsx']) {
    const s = code(f)
    assert.doesNotMatch(s, /getSessionUser|from 'next\/headers'|cookies\(\)|headers\(\)|lib\/supabase\/server'/, f)
  }
  assert.match(read('components/Navbar.tsx'), /^'use client'/)
  assert.match(read('components/SiteChrome.tsx'), /HeaderSessionProvider/)
  const route = read('app/api/session/header/route.ts')
  assert.match(route, /private, no-store/)
  assert.match(route, /force-dynamic/)
})

// ------------------------------------------------------- cached pages ---

const CACHED_PAGES = [
  'app/(site)/page.tsx',
  'app/(site)/about/page.tsx',
  'app/(site)/faq/page.tsx',
  'app/(site)/terms/page.tsx',
  'app/(site)/privacy/page.tsx',
  'app/(site)/support/page.tsx',
  'app/(site)/post-tuition/page.tsx',
  'app/(site)/blog/page.tsx',
  'app/(site)/blog/[slug]/page.tsx',
  'app/(site)/tutors/[city]/[subject]/page.tsx',
  'app/(site)/tuitions/[city]/[slug]/page.tsx',
  'app/(site)/tuition-jobs/[city]/page.tsx',
  'app/(site)/tuition-jobs/[city]/[variant]/page.tsx',
  'app/(site)/tuition-jobs/school/[school]/page.tsx',
  'app/(site)/tutor/[slug]/page.tsx',
]

const DYNAMIC_READ = /getSessionUser|cookies\(\)|headers\(\)|from 'next\/headers'|lib\/supabase\/server'|searchParams|force-dynamic/

test('cached pages: each has a time limit and reads no cookie, header or query', () => {
  for (const f of CACHED_PAGES) {
    const s = code(f)
    assert.match(s, /export const revalidate = \d+/, `${f}: revalidate`)
    assert.doesNotMatch(s, DYNAMIC_READ, f)
    if (f.includes('[')) assert.match(s, /generateStaticParams/, `${f}: dynamic route needs generateStaticParams`)
  }
})

test('cached pages: the shared views they render read no session either', () => {
  for (const f of [
    'app/(site)/blog/BlogIndex.tsx',
    'app/(site)/tutor/[slug]/profile.tsx',
    'app/(site)/tuition-jobs/[city]/render.tsx',
    'app/(site)/tuition-jobs/[city]/[variant]/render.tsx',
    'app/(site)/tuitions/[city]/[slug]/not-found.tsx',
    'components/tuitionJobs/CityJobsView.tsx',
    'components/blog/OpenTuitionsBlock.tsx',
    'components/landing/LandingView.tsx',
    'lib/company.ts',
    'lib/support.ts',
  ]) {
    assert.doesNotMatch(code(f), /getSessionUser|cookies\(\)|headers\(\)|from 'next\/headers'|lib\/supabase\/server'|auth\.getUser/, f)
  }
  // The card and profile data are read with the cookie-free client.
  const feed = read('lib/jobFeed.ts')
  assert.doesNotMatch(feed.replace(/export async function savedJobsForTutor[\s\S]*?\n}\n/, ''), /await createClient\(\)/)
  assert.match(read('lib/browseTutors.ts'), /createPublicClient/)
})

test('cached pages: the build prerender manifest lists them as cached (when a build exists)', () => {
  const manifest = '.next/prerender-manifest.json'
  if (!existsSync(manifest)) return
  const m = JSON.parse(read(manifest)) as { routes: Record<string, unknown>; dynamicRoutes: Record<string, unknown> }
  const known = new Set([...Object.keys(m.routes), ...Object.keys(m.dynamicRoutes)])
  for (const r of ['/', '/about', '/faq', '/post-tuition', '/blog', '/blog/[slug]', '/tutor/[slug]', '/tuitions/[city]/[slug]', '/tuition-jobs/[city]', '/tuition-jobs/[city]/[variant]', '/tuition-jobs/school/[school]', '/tutors/[city]/[subject]'])
    assert.ok(known.has(r), `${r} is not cached in the build`)
})

test('personal pages stay dynamic on purpose', () => {
  for (const d of ['account', 'login', 'register', 'parent', 'tutor/dashboard', 'tutor/onboarding', 'pay', 'verify-phone', 'browse'])
    assert.match(read(`app/(site)/${d}/layout.tsx`), /export const dynamic = 'force-dynamic'/, d)
})

test('rebuilt on change: tuition, tutor and blog changes mark the pages', () => {
  const idx = read('lib/googleIndexing.ts')
  assert.match(idx, /export function queueIndexingUpdate[\s\S]*?revalidatePublicTuition\(job\)/)
  assert.match(idx, /export function queueIndexingDelete[\s\S]*?revalidatePublicTuition\(job\)/)
  assert.match(read('lib/landingRevalidate.ts'), /revalidatePublicTutors\(\)/)
  assert.match(read('lib/completion.ts'), /revalidateTutorProfile\(userId\)/)
  assert.match(read('lib/auditLog.ts'), /revalidateTutorProfile\(params\.targetId\)/)
  assert.match(read('lib/activityLog.ts'), /revalidateTutorProfile\(params\.userId\)/)
  const blog = read('lib/blogPublish.ts')
  assert.match(blog, /revalidatePath\('\/blog'\)/)
  const pr = read('lib/publicRevalidate.ts')
  for (const p of ['/tuition-jobs/', "'/tutor/[slug]'", "'/tutors/[city]/[subject]'", "mark('/')"]) assert.ok(pr.includes(p), p)
})

// --------------------------------------------------------- query twins ---

test('query twins: only the query a cached page cannot read goes to the twin', () => {
  assert.equal(queryTwinPath('/blog', P('')), null)
  assert.equal(queryTwinPath('/blog', P('cluster=boards-exams')), '/qs/blog')
  assert.equal(queryTwinPath('/blog', P('page=2')), '/qs/blog')
  assert.equal(queryTwinPath('/blog', P('utm_source=fb')), null, 'tracking tags keep the cached page')
  assert.equal(queryTwinPath('/tuition-jobs/lahore', P('page=2')), '/qs/tuition-jobs/lahore')
  assert.equal(queryTwinPath('/tuition-jobs/lahore', P('page=1')), null)
  assert.equal(queryTwinPath('/tuition-jobs/lahore/female', P('page=3')), '/qs/tuition-jobs/lahore/female')
  assert.equal(queryTwinPath('/tuition-jobs/school/beaconhouse', P('page=2')), null)
  assert.equal(queryTwinPath('/tutor/ali-raza-tutor', P('preview=1')), '/qs/tutor/ali-raza-tutor')
  assert.equal(queryTwinPath('/tutor/ali-raza-tutor', P('message=1')), null, 'message=1 is read in the browser')
  assert.equal(queryTwinPath('/qs/blog', P('cluster=x')), null)
  assert.match(read('proxy.ts'), /queryTwinPath\(request\.nextUrl\.pathname, request\.nextUrl\.searchParams\)/)
  assert.match(read('app/robots.ts'), /'\/qs\/'/)
  for (const f of ['app/(site)/qs/blog/page.tsx', 'app/(site)/qs/tuition-jobs/[city]/page.tsx', 'app/(site)/qs/tuition-jobs/[city]/[variant]/page.tsx', 'app/(site)/qs/tutor/[slug]/page.tsx'])
    assert.match(read(f), /force-dynamic/, f)
  assert.equal(ownPreviewPath('ali raza'), '/tutor/ali%20raza?preview=1')
})

// ------------------------------------------------------- viewer parts ---

test('viewer: Apply on a cached card or tuition page — guests and tutors only', () => {
  assert.equal(showApplyFor(null), true)
  assert.equal(showApplyFor({ signedIn: false }), true)
  const v = { signedIn: true as const, isTutor: false, cities: [], jobTypes: [], blocks: {}, saved: [], genderBlocked: [] }
  assert.equal(showApplyFor(v), false)
  assert.equal(showApplyFor({ ...v, isTutor: true }), true)
  assert.equal(showApplyForViewer(null, true), true)
  assert.equal(showApplyForViewer(null, false), false, 'never on a paused or closed tuition')
  const t = { signedIn: true as const, isTutor: false, isAdmin: false, isPoster: true, applied: false, tutorGender: null, applyBlock: null, feeReceiptPending: false, revealedContact: null, pauseLabel: null, teamPost: false, pauseDaysLeft: null, refreshNextAt: null }
  assert.equal(showApplyForViewer(t, true), false)
  assert.equal(viewerJobIds(['a', 'a', 'b']).join(','), 'a,b')
  assert.equal(viewerJobIds(Array.from({ length: 80 }, (_, i) => String(i))).length, 60)
})

test('viewer: the profile action bar — not for a tutor looking at another tutor', () => {
  assert.equal(showProfileActions(null, false), true)
  assert.equal(showProfileActions(null, true), false, 'never while under review')
  const base = { signedIn: true as const, isSelf: false, audience: 'parent', contactUnlocked: false, contact: null, saved: false, isParent: true, hired: false }
  assert.equal(showProfileActions(base, false), true)
  assert.equal(showProfileActions({ ...base, audience: 'tutor' }, false), false)
  assert.equal(showProfileActions({ ...base, audience: 'tutor', isSelf: true }, false), true)
})

test('viewer: a number never reaches the cached HTML', () => {
  const route = read('app/api/viewer/tutor/route.ts')
  assert.match(route, /contactUnlocked && admin/)
  assert.match(route, /private, no-store/)
  const profile = read('app/(site)/tutor/[slug]/profile.tsx')
  assert.doesNotMatch(profile, /phone_number, whatsapp/, 'the profile view no longer reads the phone')
  for (const f of ['app/api/viewer/jobs/route.ts', 'app/api/viewer/tuition/route.ts', 'app/api/viewer/tutor/view/route.ts'])
    assert.match(read(f), /force-dynamic/, f)
})

// ---------------------------------------------------- in-memory cache ---

test('memo cache: shares one answer until its time is up, drops failures, clears by tag', async () => {
  let n = 0
  const f = memoize(async (x: number) => x + ++n, ['t-push3'], { revalidate: 60, tags: ['t-tag'] })
  assert.equal(await f(10), 11)
  assert.equal(await f(10), 11, 'cached')
  assert.equal(await f(20), 22, 'other arguments are their own entry')
  invalidateMemoTag('t-tag')
  assert.equal(await f(10), 13, 'refilled after the tag cleared')
  const tally = memoTallyForTests().get('t-push3')!
  assert.deepEqual(tally, { calls: 4, hits: 1, refills: 3 })
  let fail = true
  const g = memoize(async () => {
    if (fail) throw new Error('down')
    return 'ok'
  }, ['t-push3-fail'])
  await assert.rejects(g())
  fail = false
  assert.equal(await g(), 'ok', 'a failure is not kept')
})

test('memo cache: no unstable_cache and no Data Cache tag left in the app', () => {
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((x) => {
      const p = join(d, x)
      return statSync(p).isDirectory() ? (x === 'node_modules' || x.startsWith('.') ? [] : walk(p)) : /\.(ts|tsx)$/.test(x) ? [p] : []
    })
  for (const f of [...walk('lib'), ...walk('app'), ...walk('components')]) {
    const s = code(f)
    assert.doesNotMatch(s, /unstable_cache\(|revalidateTag\(|next:\s*\{\s*(revalidate|tags)/, f)
  }
})

// ------------------------------------------------------ summary job ---

test('summary job: one heavy load per run', async () => {
  assert.equal(inRunMemo(), false)
  let loads = 0
  const load = () => runMemo('x', async () => ++loads)
  await withRunMemo(async () => {
    assert.equal(inRunMemo(), true)
    await Promise.all([load(), load(), load()])
  })
  assert.equal(loads, 1)
  await load()
  await load()
  assert.equal(loads, 3, 'outside a run nothing is shared')
  assert.match(read('lib/adminSummary.ts'), /withRunMemo\(\(\) => rebuildOnce\(opts\)\)/)
  assert.match(read('lib/staffOutreach.ts'), /runMemo\('unpaid:all'/)
  assert.match(read('lib/tutorFollowUps.ts'), /runMemo\('tfu:built'/)
  assert.match(read('lib/peopleDirectory.ts'), /runMemo\('directory'/)
})

test('summary job: a change waits for a 3-minute gap; Refresh never waits', () => {
  const built = Date.parse('2026-11-01T10:00:00Z')
  const s = { builtAt: new Date(built).toISOString(), startedAt: new Date(built).toISOString(), dirtyAt: new Date(built + 30_000).toISOString() }
  assert.equal(needsRebuild(s, built + 60_000), false)
  assert.equal(needsRebuild(s, built + MIN_DIRTY_GAP_MS), true)
  assert.equal(needsRebuild(s, built + 60_000, true), true)
  const t = addRunToTally({}, built, 7000, 5000)
  assert.deepEqual(t['2026-11-01'], { runs: 1, wallMs: 7000, cpuMs: 5000 })
})
