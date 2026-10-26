// scripts/test-hotfix-errors.ts — hotfix, 26 Oct 2026 (Supabase 502s / 300 s
// hangs, receipt uploads, View-as writes, bank payments on hand-entered credits).
//
//   npm run test:hotfix          (offline)
//   npm run test:hotfix:live     (production, rolled back / dry run — writes nothing)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { makeSupabaseFetch, plainSupabaseError, timeoutFor, SUPABASE_STORAGE_TIMEOUT_MS, SUPABASE_TIMEOUT_MS } from '@/lib/supabase/fetch'
import { makeBackoff, PROXY_LOOKUP_TIMEOUT_MS } from '@/lib/proxyLookup'
import { prepareReceiptFile, looksLikeImage, RECEIPT_TARGET_BYTES } from '@/lib/payments/receiptPrepare'
import { RECEIPT_MAX_BYTES, receiptFileProblem } from '@/lib/payments/receiptCore'
import { viewAsDecision } from '@/lib/viewAsCore'
import { creditPaidAt, linkDecision, bankPaymentRow, type LinkPlan } from '@/lib/bankPaymentLinkCore'

const noSleep = async () => {}
const respond = (status: number) => new Response(status === 200 ? '[]' : '<html><title>502 Bad Gateway</title></html>', { status })

// ── Supabase fetch: time limit + one retry for reads ─────────────────────────

test('a read that gets a 502 is tried once more and the second answer is used', async () => {
  const seen: number[] = []
  const f = makeSupabaseFetch(async () => {
    seen.push(seen.length)
    return respond(seen.length === 1 ? 502 : 200)
  }, noSleep)
  const res = await f('https://x.supabase.co/rest/v1/jobs?select=id', { method: 'GET' })
  assert.equal(res.status, 200)
  assert.equal(seen.length, 2)
})

test('a read is tried at most twice', async () => {
  let calls = 0
  const f = makeSupabaseFetch(async () => {
    calls++
    return respond(503)
  }, noSleep)
  const res = await f('https://x.supabase.co/auth/v1/user')
  assert.equal(res.status, 503)
  assert.equal(calls, 2)
})

test('a write is never repeated, even after a 502 or a network error', async () => {
  let calls = 0
  const f502 = makeSupabaseFetch(async () => {
    calls++
    return respond(502)
  }, noSleep)
  assert.equal((await f502('https://x.supabase.co/rest/v1/payments', { method: 'POST', body: '{}' })).status, 502)
  assert.equal(calls, 1)
  calls = 0
  const fErr = makeSupabaseFetch(async () => {
    calls++
    throw new TypeError('fetch failed')
  }, noSleep)
  await assert.rejects(fErr('https://x.supabase.co/rest/v1/rpc/thing', { method: 'POST', body: '{}' }))
  assert.equal(calls, 1)
})

test('a hung request is cut off at its time limit instead of waiting 300 s', async () => {
  const hang: typeof fetch = (_i, init) =>
    new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(init.signal!.reason), { once: true }))
  const f = makeSupabaseFetch(hang, noSleep, { timeoutFor: () => 30 })
  const t0 = Date.now()
  await assert.rejects(f('https://x.supabase.co/rest/v1/jobs', { method: 'PATCH', body: '{}' }))
  assert.ok(Date.now() - t0 < 2000)
})

test('a caller that aborts is not retried', async () => {
  let calls = 0
  const ctl = new AbortController()
  const f = makeSupabaseFetch(
    (_i, init) =>
      new Promise((_res, rej) => {
        calls++
        init?.signal?.addEventListener('abort', () => rej(new Error('aborted')), { once: true })
      }),
    noSleep,
  )
  const p = f('https://x.supabase.co/rest/v1/jobs', { signal: ctl.signal })
  ctl.abort()
  await assert.rejects(p)
  assert.equal(calls, 1)
})

test('storage gets a long time limit (slow uploads from phones), everything else 25 s', () => {
  assert.equal(timeoutFor('https://x.supabase.co/storage/v1/object/payment-proofs/a.jpg'), SUPABASE_STORAGE_TIMEOUT_MS)
  assert.equal(timeoutFor('https://x.supabase.co/rest/v1/jobs'), SUPABASE_TIMEOUT_MS)
  assert.ok(SUPABASE_TIMEOUT_MS < 300_000)
})

test('an HTML gateway page becomes one plain line (the 834679845 error)', () => {
  const page = '<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body><center>cloudflare</center></body></html>'
  assert.equal(plainSupabaseError(page), 'Supabase answered an error page: 502 Bad Gateway')
  assert.equal(plainSupabaseError('permission denied'), 'permission denied')
  assert.equal(plainSupabaseError(''), 'Supabase request failed')
})

test('every server Supabase client uses the guarded fetch', () => {
  for (const f of ['lib/supabase/server.ts', 'lib/supabase/admin.ts', 'lib/supabase/public.ts', 'proxy.ts']) {
    assert.match(readFileSync(f, 'utf8'), /global: \{ fetch: supabaseFetch \}/, f)
  }
  assert.match(readFileSync('lib/pageAll.ts', 'utf8'), /plainSupabaseError\(error\.message\)/)
})

// ── Proxy redirect lookups: time limit + back-off ────────────────────────────

test('proxy lookups give up quickly and back off after a failure', () => {
  assert.ok(PROXY_LOOKUP_TIMEOUT_MS <= 3000)
  const b = makeBackoff(30_000)
  assert.equal(b.waiting(1_000), false)
  b.failed(1_000)
  assert.equal(b.waiting(20_000), true)
  assert.equal(b.waiting(31_001), false)
  for (const f of ['lib/mergedTutorRedirect.ts', 'lib/convertedTutorRedirect.ts', 'lib/hiddenTuitionRedirect.ts', 'lib/areaHubRedirect.ts']) {
    const src = readFileSync(f, 'utf8')
    assert.doesNotMatch(src, /await fetch\(/, `${f} still calls fetch without a time limit`)
    assert.match(src, /backoff\.waiting\(\)/, f)
    assert.match(src, /backoff\.failed\(\)/, f)
  }
})

// ── Receipt upload on /pay/choose ────────────────────────────────────────────

const fakeFile = (size: number, type: string, name = 'receipt.jpg') => ({ size, type, name }) as unknown as File

test('the receipt limit is under the ~4.5 MB Vercel request cap', () => {
  assert.ok(RECEIPT_MAX_BYTES < 4.5 * 1024 * 1024)
  assert.ok(RECEIPT_TARGET_BYTES < RECEIPT_MAX_BYTES)
})

test('a large phone photo is compressed below the limit before it is checked', async () => {
  const photo = fakeFile(7 * 1024 * 1024, 'image/jpeg')
  const steps: number[] = []
  const out = await prepareReceiptFile(photo, async (_f, o) => {
    steps.push(o.maxEdge)
    return fakeFile(o.maxEdge === 2000 ? 3.2 * 1024 * 1024 : 1.9 * 1024 * 1024, 'image/jpeg')
  })
  assert.ok(out.size <= RECEIPT_TARGET_BYTES)
  assert.deepEqual(steps, [2000, 1800])
  assert.equal(receiptFileProblem({ type: out.type, size: out.size }), null)
})

test('a PDF is sent as it is; a broken compressor never blocks the upload', async () => {
  const pdf = fakeFile(1024, 'application/pdf', 'r.pdf')
  assert.equal(await prepareReceiptFile(pdf, async () => { throw new Error('should not run') }), pdf)
  const photo = fakeFile(2 * 1024 * 1024, 'image/png', 'r.png')
  assert.equal(await prepareReceiptFile(photo, async () => { throw new Error('no canvas') }), photo)
  assert.equal(looksLikeImage({ type: '', name: 'IMG_0001.HEIC' }), true)
})

test('the payment screen compresses before checking and explains a 413', () => {
  const src = readFileSync('app/(site)/pay/choose/PayChoice.tsx', 'utf8')
  assert.match(src, /prepareReceiptFile\(picked, compressImage\)/)
  assert.match(src, /res\.status === 413/)
})

test('the receipt route stores through the service role, so RLS and the View-as storage policies cannot block it', () => {
  const src = readFileSync('app/api/payments/receipt/route.ts', 'utf8')
  assert.match(src, /admin\.storage/)
})

// ── View-as still refuses every write ────────────────────────────────────────

test('View-as: every non-GET request and every auth/admin API is blocked in the proxy', () => {
  const t = { id: 'x', expiresAt: 10_000 }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(viewAsDecision(t, { method, pathname: '/api/profile/save' }, 1), 'block')
  assert.equal(viewAsDecision(t, { method: 'GET', pathname: '/api/admin/users' }, 1), 'block')
  assert.equal(viewAsDecision(t, { method: 'GET', pathname: '/tutor/dashboard' }, 1), 'pass')
})

test('View-as database policies cover writes only (never reads) and run once per statement', () => {
  const sql = readFileSync('supabase/migrations/201_status_merge_parents_viewas.sql', 'utf8')
  assert.match(sql, /as restrictive for insert/)
  assert.match(sql, /as restrictive for update/)
  assert.match(sql, /as restrictive for delete/)
  assert.doesNotMatch(sql, /as restrictive for (select|all)/)
  assert.match(sql, /\(select public\.is_view_as_session\(\)\)/)
  assert.match(sql, /session_id uuid not null unique/)
  assert.match(sql, /function public\.is_view_as_session\(\)[\s\S]*?stable[\s\S]*?security definer/)
})

// ── Record a bank payment against a credit added by hand ─────────────────────

const fee: LinkPlan = { code: 'verified', name: 'Verification Fee', audience: 'tutor', pricePkr: 199, active: true }

test('a hand-entered, unmatched credit can be recorded for an unpaid tutor (activate)', () => {
  const d = linkDecision({ memberRole: 'tutor', feePaidAt: null, plan: fee, payments: [], subs: [], creditState: 'unmatched', creditMatch: null, creditAmountPkr: 199, amountPkr: 199 })
  assert.deepEqual(d, { ok: true, mode: 'activate' })
})

test('a hand-entered credit with no time recorded counts at noon on its own day', () => {
  assert.equal(creditPaidAt('2026-10-26', null), '2026-10-26T07:00:00.000Z')
  assert.equal(creditPaidAt('2026-10-26', '17:03:00'), '2026-10-26T12:03:00.000Z')
})

test('recording the same fee twice is refused (Nosheen\'s second try after the error page)', () => {
  const d = linkDecision({
    memberRole: 'tutor',
    feePaidAt: '2026-10-26T07:00:00Z',
    plan: fee,
    payments: [{ id: 'p1', planCode: 'verified', status: 'approved' }],
    subs: [],
    creditState: 'unmatched',
    creditAmountPkr: 199,
    amountPkr: 199,
  })
  assert.equal(d.ok, false)
})

test('the payment row for a linked credit is a pending bank transfer on the manual provider', () => {
  const row = bankPaymentRow({ userId: 'u', planCode: 'verified', amountPkr: 199, providerRef: 'TM-X', bankReference: null, creditId: 'c', creditDate: '2026-10-26' })
  assert.equal(row.status, 'pending')
  assert.equal(row.provider, 'manual')
  assert.equal(row.method, 'bank')
})
