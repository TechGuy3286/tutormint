/**
 * scripts/test-browse-live.ts — Browse must show its list (hotfix, 2 Nov 2026).
 *
 * On 2 Nov 2026 signed-in members saw "The directory could not be loaded" on
 * /browse/tutors: rank_tutors() had grown to 1.4–2.4 s and the anon role's 3 s
 * statement timeout cancelled it (migration 221 fixed it). This test fails if
 * that comes back.
 *
 *   1. HTTP (BROWSE_BASE_URL, default https://www.tutormint.org; point it at a
 *      local `npm start` to test a build): /browse/tutors and /browse/tuitions,
 *      with and without ?city=Lahore, signed out, phone and desktop user agents,
 *      AND with a sign-in cookie so proxy.ts sends the request to the live twin
 *      (/qs/browse/…) — the path every signed-in member takes. The cookie holds
 *      an invented, unsigned session: it routes the request exactly like a real
 *      one and signs nobody in. Each page must answer 200, must not say "could
 *      not be loaded", and must list cards when the database has rows.
 *   2. Database (rolled back, writes nothing): rank_tutors() run as anon AND as
 *      a signed-in member (role authenticated, an invented user id in the JWT
 *      claims — no account is created) must return rows when the directory has
 *      tutors, and must finish well inside the anon 3 s limit (1 s budget,
 *      repeated so a pooled connection's plan cache is exercised).
 *
 * Read only. Prints counts and timings, never a name, number or key.
 *
 *   npx tsx --env-file=.env.local --test scripts/test-browse-live.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
// @ts-expect-error pg ships no bundled types
import pg from 'pg'

const BASE = (process.env.BROWSE_BASE_URL || 'https://www.tutormint.org').replace(/\/$/, '')
const PROJECT_REF = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').hostname.split('.')[0]
  } catch {
    return 'yhekiqtelsictqkfxrfj'
  }
})()
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
// An invented session cookie (not a real token): enough for proxy.ts to treat
// the visitor as signed in and route to the live twin; Supabase rejects it.
const FAKE_SESSION = `sb-${PROJECT_REF}-auth-token=base64-${Buffer.from(JSON.stringify({ access_token: 'invented', refresh_token: 'invented' })).toString('base64')}`

const BROKEN = /could not be loaded/i

async function dbCounts() {
  if (!process.env.SUPABASE_DB_URL) return null
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const { rows } = await c.query(`select
      (select count(*)::int from tutor_directory) tutors,
      (select count(*)::int from tutor_directory where lower(city) = 'lahore') lahore_tutors,
      (select count(*)::int from jobs where status = 'open') tuitions`)
    return rows[0] as { tutors: number; lahore_tutors: number; tuitions: number }
  } finally {
    await c.end()
  }
}

async function load(path: string, ua: string, cookie?: string) {
  const res = await fetch(BASE + path, {
    headers: { 'user-agent': ua, ...(cookie ? { cookie } : {}) },
    redirect: 'manual',
    signal: AbortSignal.timeout(60_000),
  })
  const html = await res.text()
  return { status: res.status, html }
}

const tutorCards = (html: string) => new Set(html.match(/href="\/tutor\/[a-z0-9-]+"/g) ?? []).size
const tuitionCards = (html: string) => new Set(html.match(/href="\/tuitions\/[a-z0-9-]+\/[a-z0-9-]+"/g) ?? []).size

test('Browse pages show their list — signed out, filtered, signed-in route, phone and desktop', async () => {
  const counts = await dbCounts()
  const cases: { path: string; kind: 'tutors' | 'tuitions'; expectRows: boolean }[] = [
    { path: '/browse/tutors', kind: 'tutors', expectRows: (counts?.tutors ?? 1) > 0 },
    { path: '/browse/tutors?city=Lahore', kind: 'tutors', expectRows: (counts?.lahore_tutors ?? 1) > 0 },
    { path: '/browse/tuitions', kind: 'tuitions', expectRows: (counts?.tuitions ?? 1) > 0 },
    { path: '/browse/tuitions?city=Lahore', kind: 'tuitions', expectRows: (counts?.tuitions ?? 1) > 0 },
  ]
  const failures: string[] = []
  for (const c of cases) {
    for (const [who, ua, cookie] of [
      ['signed out · phone', PHONE_UA, undefined],
      ['signed out · desktop', DESKTOP_UA, undefined],
      ['signed-in route · phone', PHONE_UA, FAKE_SESSION],
      ['signed-in route · desktop', DESKTOP_UA, FAKE_SESSION],
    ] as const) {
      const { status, html } = await load(c.path, ua, cookie)
      const cards = c.kind === 'tutors' ? tutorCards(html) : tuitionCards(html)
      console.log(`${c.path} [${who}] ${status} cards=${cards}`)
      if (status !== 200) failures.push(`${c.path} [${who}] answered ${status}`)
      if (BROKEN.test(html)) failures.push(`${c.path} [${who}] says "could not be loaded"`)
      if (c.expectRows && cards === 0) failures.push(`${c.path} [${who}] shows no cards while rows exist`)
    }
  }
  assert.deepEqual(failures, [])
})

test('rank_tutors returns rows quickly as anon and as a signed-in member (rolled back)', async (t) => {
  if (!process.env.SUPABASE_DB_URL) return t.skip('SUPABASE_DB_URL not set')
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    const { rows } = await c.query(`select count(*)::int n from tutor_directory`)
    const listed = rows[0].n as number
    await c.query('begin')
    for (const role of ['anon', 'authenticated'] as const) {
      await c.query('savepoint r')
      await c.query(`set local role ${role}`)
      if (role === 'authenticated') {
        // An invented member id: no account exists or is created.
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: randomUUID(), role: 'authenticated' })])
      }
      for (let i = 0; i < 8; i++) {
        for (const args of [`p_limit=>12, p_offset=>0`, `p_limit=>12, p_offset=>0, p_city=>'Lahore'`]) {
          const t0 = Date.now()
          const r = await c.query(`select id, total_count from rank_tutors(${args})`)
          const ms = Date.now() - t0
          if (i === 0 || i === 7) console.log(`${role} ${args.includes('Lahore') ? 'Lahore' : 'all'} call ${i + 1}: ${r.rows.length} rows, ${ms} ms`)
          if (listed > 0 && !args.includes('Lahore')) assert.ok(r.rows.length > 0, `${role}: no rows while ${listed} tutors are listed`)
          assert.ok(ms < 1000, `${role}: rank_tutors took ${ms} ms (anon limit is 3 s)`)
        }
      }
      await c.query('rollback to savepoint r')
    }
    await c.query('rollback')
  } finally {
    await c.end()
  }
})
