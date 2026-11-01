#!/usr/bin/env node
/**
 * scripts/test-static-render-live.mjs — npm run test:staticrender:live
 *
 * Hotfix (owner, 1 Nov 2026): fails if any cached (ISR) page reads request
 * headers or writes to the database while it is built.
 *
 * Needs a production build (`npm run build`). Serves it locally with
 * `next start` (it reads the database named in .env.local — reads only: every
 * write during a cached page build is refused by lib/supabase/fetch and logged
 * as [static-write]), loads every kind of cached page FRESH (dynamic pages are
 * never prerendered at build, so the first load builds them exactly as an ISR
 * refresh does), loads each again to see it served from the cache, and scans
 * the server's own log.
 *
 * Fails on: a 500 (or any status other than the one expected), a page that is
 * not served from the cache the second time, or any of these in the log —
 * "static to dynamic", DYNAMIC_SERVER_USAGE, [static-write].
 *
 *   node scripts/test-static-render-live.mjs            # port 3999
 *   PORT=4000 node scripts/test-static-render-live.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const PORT = Number(process.env.PORT || 3999)
const ORIGIN = `http://localhost:${PORT}`
const PER_KIND = Number(process.env.PER_KIND || 4)

if (!existsSync('.next/BUILD_ID')) {
  console.error('No production build. Run `npm run build` first.')
  process.exit(2)
}

/** The pages whose first renders failed with "static to dynamic" on 1 Nov 2026. */
const LOGGED_PATHS = [
  '/tuitions/karachi/accademic-co-ordinator-grade-9-10-bahadurabad-karachi-588a69',
  '/tutor/abdul-ahad-khan-tutor',
  '/tuition-jobs/abbottabad',
  '/tuitions/peshawar/grade-7-mathematics',
  '/tuitions/peshawar/grade-7-urdu',
  '/tuitions/lahore/female-sports-teacher-required-grade-1-5-the-punjab-school-lahore-bc4253',
  '/tuitions/lahore/female-home-tutor-required-grade-3-sadar-cantt-lahore-caa52f',
]

const BAD = [/static to dynamic/i, /DYNAMIC_SERVER_USAGE/, /\[static-write\]/]
let log = ''
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  // DEV_DEFAULT_OTP lives in .env.local for development; the startup guard
  // (lib/sms assertOtpSafety) refuses a production server that has it, so it
  // is blanked for this local production run only.
  env: { ...process.env, NODE_ENV: 'production', DEV_DEFAULT_OTP: '' },
})
server.stdout.on('data', (d) => (log += d))
server.stderr.on('data', (d) => (log += d))

const stop = () => {
  try {
    server.kill()
  } catch {
    /* gone */
  }
}
process.on('exit', stop)

async function get(path) {
  const res = await fetch(ORIGIN + path, { redirect: 'manual', headers: { 'user-agent': 'TutorMint-static-render-test' } })
  await res.arrayBuffer()
  return { status: res.status, cache: res.headers.get('x-nextjs-cache') ?? '' }
}

async function waitUp() {
  for (let i = 0; i < 120; i++) {
    try {
      await fetch(ORIGIN + '/robots.txt')
      return
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  throw new Error('next start did not come up')
}

async function sitemapPaths(file) {
  const res = await fetch(`${ORIGIN}/${file}`)
  const xml = await res.text()
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname)
}

function pick(paths, re, n = PER_KIND) {
  return paths.filter((p) => re.test(p)).slice(0, n)
}

async function main() {
  await waitUp()
  const pages = await sitemapPaths('sitemap-pages.xml')
  const tuitions = await sitemapPaths('sitemap-tuitions.xml')
  const tutors = await sitemapPaths('sitemap-tutors.xml')
  const blog = await sitemapPaths('sitemap-blog.xml')

  /** [path, expected status] */
  const targets = [
    ['/', 200],
    ['/about', 200],
    ['/faq', 200],
    ['/terms', 200],
    ['/privacy', 200],
    ['/support', 200],
    ['/post-tuition', 200],
    ['/blog', 200],
    ...pick(blog, /^\/blog\/./).map((p) => [p, 200]),
    ...pick(tuitions, /^\/tuitions\//).map((p) => [p, 200]),
    ...pick(tutors, /^\/tutor\//).map((p) => [p, 200]),
    ...pick(pages, /^\/tutors\/[^/]+\/[^/]+$/).map((p) => [p, 200]),
    ...pick(pages, /^\/tuitions\/[^/]+\/[^/]+$/).map((p) => [p, 200]),
    ...pick(pages, /^\/tuition-jobs\/[^/]+$/).map((p) => [p, 200]),
    ...pick(pages, /^\/tuition-jobs\/(?!school\/)[^/]+\/[^/]+$/).map((p) => [p, 200]),
    ...pick(pages, /^\/tuition-jobs\/school\//).map((p) => [p, 200]),
    // The pages named in the 1 Nov logs, any extra ones asked for, and made-up
    // addresses that must be 404.
    ...LOGGED_PATHS.map((p) => [p, 200]),
    ...(process.env.EXTRA_PATHS ?? '').split(',').filter(Boolean).map((p) => [p, 200]),
    ['/tutor/no-such-tutor-xyz', 404],
    ['/tuitions/lahore/no-such-tuition-abc123', 404],
  ]

  const problems = []
  for (const [path, want] of targets) {
    const first = await get(path)
    // A page that was moved since the sitemap was read may redirect; that is fine.
    const okFirst = first.status === want || (want === 200 && [301, 307, 308].includes(first.status))
    if (!okFirst) problems.push(`${path}: first load ${first.status} (wanted ${want})`)
    if (first.status === 200) {
      const second = await get(path)
      if (second.status !== 200) problems.push(`${path}: second load ${second.status}`)
      else if (!/HIT|STALE/.test(second.cache)) problems.push(`${path}: second load not from the cache (x-nextjs-cache: ${second.cache || 'none'})`)
    }
    console.log(`${String(first.status).padEnd(3)} ${path}`)
  }
  await new Promise((r) => setTimeout(r, 1500))
  for (const line of log.split('\n')) {
    if (BAD.some((re) => re.test(line))) problems.push(`log: ${line.trim().slice(0, 300)}`)
  }
  stop()
  console.log(`\n${targets.length} cached pages loaded fresh, then from the cache.`)
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`)
    for (const p of problems) console.error(`  ${p}`)
    process.exit(1)
  }
  console.log('No header reads, no database writes, no 500s while building cached pages.')
}

main().catch((e) => {
  console.error(e)
  stop()
  process.exit(1)
})
