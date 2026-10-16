// scripts/test-email-send.ts — the one send path (owner, 16 Oct 2026).
//   npm run test:emailsend
//
// No network: Resend is a fake fetch, time is a fake clock (sleeping advances
// it), and the recorder keeps rows in memory.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { chunk, classify, parseRetryAfter, backoffMs, RateLimiter, type Clock } from '../lib/email/core'
import {
  sendOne,
  sendBulk,
  __setEmailDepsForTests,
  RESEND_BATCH,
  RESEND_EMAILS,
  type EmailMessage,
  type Recorder,
  type SendRow,
  type RunRow,
} from '../lib/email/send'
import { recipientProblem } from '../lib/notify/recipient'
import { looksLikeEmail } from '../lib/phone'

// --------------------------------------------------------------- harness --

function fakeClock(): Clock & { t: number } {
  const c = {
    t: 1_000_000,
    now: () => c.t,
    // Time moves when the sleep ends, after everything already woken has run.
    sleep: (ms: number) =>
      new Promise<void>((r) =>
        setImmediate(() => {
          c.t += ms
          r()
        }),
      ),
  }
  return c
}

type Call = { url: string; at: number; key: string; body: unknown }
type Reply = { status: number; body?: unknown; retryAfter?: string }

function harness(reply: (call: Call, n: number) => Reply = () => ({ status: 200, body: { id: 'x' } })) {
  const clock = fakeClock()
  const calls: Call[] = []
  const rows: SendRow[] = []
  const runs: RunRow[] = []
  const recorder: Recorder = {
    async sends(r) {
      rows.push(...r)
    },
    async runStart() {},
    async runFinish(r) {
      runs.push(r)
    },
  }
  const lines: string[] = []
  const fetchFn = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>
    const call: Call = { url, at: clock.now(), key: headers['Idempotency-Key'], body: JSON.parse(init.body as string) }
    calls.push(call)
    const r = reply(call, calls.length)
    const body =
      r.body ??
      (url === RESEND_BATCH && r.status === 200
        ? { data: (call.body as unknown[]).map((_, i) => ({ id: `e${calls.length}-${i}` })) }
        : { id: `e${calls.length}` })
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      headers: { get: (h: string) => (h.toLowerCase() === 'retry-after' ? (r.retryAfter ?? null) : null) },
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response
  }) as unknown as typeof fetch
  __setEmailDepsForTests({
    fetch: fetchFn,
    clock,
    random: () => 0.5,
    recorder: async () => recorder,
    apiKey: () => 're_test',
    production: () => true,
    log: (l) => lines.push(l),
  })
  return { clock, calls, rows, runs, lines }
}

function msgs(n: number): EmailMessage[] {
  return Array.from({ length: n }, (_, i) => ({ to: `parent${i}@example.com`, subject: 'Your tuition is paused', text: 'body', template: 'tuition_paused' }))
}

/** Never more than `max` request starts in any 1,000 ms window. */
function maxInAnySecond(times: number[]): number {
  let best = 0
  for (const t of times) best = Math.max(best, times.filter((u) => u >= t && u < t + 1000).length)
  return best
}

// ----------------------------------------------------------------- tests --

test('chunk: 250 → 100, 100, 50', () => {
  assert.deepEqual(chunk(Array.from({ length: 250 }, (_, i) => i)).map((c) => c.length), [100, 100, 50])
  assert.deepEqual(chunk([]), [])
})

test('sendBulk: a 250-message list is 3 batch requests, every message delivered and recorded', async () => {
  const h = harness()
  try {
    const { results, summary } = await sendBulk(msgs(250), { job: 'tuition_paused' })
    assert.equal(h.calls.length, 3)
    assert.ok(h.calls.every((c) => c.url === RESEND_BATCH))
    assert.deepEqual(h.calls.map((c) => (c.body as unknown[]).length), [100, 100, 50])
    assert.equal(results.length, 250)
    assert.ok(results.every((r) => r.ok))
    assert.deepEqual(
      { attempted: summary.attempted, delivered: summary.delivered, failed: summary.failed, requests: summary.requests },
      { attempted: 250, delivered: 250, failed: 0, requests: 3 },
    )
    assert.equal(h.rows.length, 250)
    assert.ok(h.rows.every((r) => r.status === 'sent' && r.mode === 'bulk' && r.template === 'tuition_paused'))
    assert.equal(h.runs.length, 1)
    assert.match(h.lines.join('\n'), /attempted 250, delivered 250, failed 0, skipped 0 \(3 requests\)/)
    // Same body as one email used to be.
    const first = (h.calls[0].body as Record<string, unknown>[])[0]
    assert.deepEqual(first.to, ['parent0@example.com'])
    assert.equal(first.subject, 'Your tuition is paused')
  } finally {
    __setEmailDepsForTests()
  }
})

test('150 recipients (the 03:00 run) is 2 requests, not 150', async () => {
  const h = harness()
  try {
    await sendBulk(msgs(150), { job: 'tuition_paused' })
    assert.equal(h.calls.length, 2)
  } finally {
    __setEmailDepsForTests()
  }
})

test('limiter: never more than 5 request starts in any second', async () => {
  const clock = fakeClock()
  const lim = new RateLimiter(5, clock)
  const starts: number[] = []
  await Promise.all(Array.from({ length: 23 }, () => lim.acquire().then(() => starts.push(clock.now()))))
  assert.equal(starts.length, 23)
  assert.ok(maxInAnySecond(starts) <= 5, `max ${maxInAnySecond(starts)} in a second`)
  // and it does not dawdle: 23 starts fit in a little over 4 seconds
  assert.ok(starts[22] - starts[0] <= 4_100)
})

test('limiter holds across the module: 30 single emails at once go out at ≤ 5 a second', async () => {
  const h = harness()
  try {
    await Promise.all(msgs(30).map((m) => sendOne(m)))
    assert.equal(h.calls.length, 30)
    assert.ok(maxInAnySecond(h.calls.map((c) => c.at)) <= 5)
  } finally {
    __setEmailDepsForTests()
  }
})

test('a 429 is retried with backoff (Retry-After honoured) and then succeeds, under one idempotency key', async () => {
  const h = harness((_c, n) => (n <= 2 ? { status: 429, retryAfter: '2', body: { message: 'Too many requests' } } : { status: 200 }))
  try {
    const { results, summary } = await sendBulk(msgs(10), { job: 'plan_expiring' })
    assert.equal(h.calls.length, 3)
    assert.ok(results.every((r) => r.ok && r.attempts === 3))
    assert.equal(summary.delivered, 10)
    assert.equal(new Set(h.calls.map((c) => c.key)).size, 1, 'every retry carries the same Idempotency-Key')
    assert.ok(h.calls[1].at - h.calls[0].at >= 2000, 'waited at least Retry-After')
    assert.ok(h.rows.every((r) => r.status === 'sent' && r.attempts === 3))
  } finally {
    __setEmailDepsForTests()
  }
})

test('a 429 that never clears gives up after 5 attempts and is recorded as failed', async () => {
  const h = harness(() => ({ status: 429 }))
  try {
    const r = await sendOne(msgs(1)[0])
    assert.equal(r.ok, false)
    assert.equal(h.calls.length, 5)
    assert.equal(h.rows[0].status, 'failed')
    assert.equal(h.rows[0].attempts, 5)
    assert.equal(h.rows[0].http_status, 429)
  } finally {
    __setEmailDepsForTests()
  }
})

test('a 422 is not retried and is recorded as a permanent failure with the error', async () => {
  const h = harness(() => ({ status: 422, body: { name: 'validation_error', message: 'Invalid `to` field.' } }))
  try {
    const { results, summary } = await sendBulk(msgs(3), { job: 'content_digest' })
    assert.equal(h.calls.length, 1)
    assert.ok(results.every((r) => !r.ok))
    assert.equal(summary.failed, 3)
    assert.ok(h.rows.every((r) => r.status === 'failed' && r.attempts === 1 && r.http_status === 422))
    assert.match(h.rows[0].error ?? '', /422.*Invalid/)
    const one = await sendOne(msgs(1)[0])
    assert.equal(one.ok, false)
    assert.equal(h.calls.length, 2, 'sendOne did not retry the 422 either')
  } finally {
    __setEmailDepsForTests()
  }
})

test('each chunk has its own idempotency key; retrying one chunk never re-sends another', async () => {
  const h = harness((c, n) => (n === 2 ? { status: 503 } : { status: 200 }))
  try {
    await sendBulk(msgs(150), { job: 'x' })
    assert.equal(h.calls.length, 3)
    assert.notEqual(h.calls[0].key, h.calls[1].key)
    assert.equal(h.calls[1].key, h.calls[2].key, 'the retried chunk reused its key')
  } finally {
    __setEmailDepsForTests()
  }
})

test('sendOne bypasses the bulk queue: it goes out before the next waiting bulk chunk', async () => {
  const h = harness()
  try {
    const bulk = sendBulk(msgs(900), { job: 'big' }) // 9 requests: the limiter must wait after 5
    while (h.calls.length < 5) await new Promise((r) => setImmediate(r))
    const one = sendOne({ to: 'member@example.com', subject: 'Reset', text: 't', template: 'password' })
    await Promise.all([bulk, one])
    assert.equal(h.calls.length, 10)
    const order = h.calls.map((c) => c.url)
    assert.equal(order[5], RESEND_EMAILS, `sendOne should be the 6th request, got ${order.join(', ')}`)
    const single = h.rows.find((r) => r.recipient === 'member@example.com')
    assert.equal(single?.mode, 'one')
    assert.equal(single?.run_id, null)
    assert.ok(maxInAnySecond(h.calls.map((c) => c.at)) <= 5)
  } finally {
    __setEmailDepsForTests()
  }
})

test('an invalid address is skipped with a recorded reason, never sent', async () => {
  const h = harness()
  try {
    const list = [...msgs(2), { to: 'ali@gmail..com', subject: 's', text: 't' }, { to: ' x@y.com', subject: 's', text: 't' }]
    const { results, summary } = await sendBulk(list, { job: 'j' })
    assert.equal(h.calls.length, 1)
    assert.equal((h.calls[0].body as unknown[]).length, 2)
    assert.equal(summary.skipped, 2)
    assert.equal(results[2].ok, false)
    const skipped = h.rows.filter((r) => r.status === 'skipped')
    assert.equal(skipped.length, 2)
    assert.ok(skipped.every((r) => r.attempts === 0 && /invalid address/.test(r.error ?? '')))
    const one = await sendOne({ to: 'not-an-address', subject: 's', text: 't' })
    assert.equal(one.ok, false)
    assert.equal(h.calls.length, 1, 'no request for an invalid single address')
  } finally {
    __setEmailDepsForTests()
  }
})

test('no key in production: every message fails with the reason, and is recorded', async () => {
  const h = harness()
  __setEmailDepsForTests({ ...{}, apiKey: () => undefined, production: () => true, recorder: async () => ({ sends: async (r) => void h.rows.push(...r), runStart: async () => {}, runFinish: async () => {} }), log: () => {} })
  try {
    const { results } = await sendBulk(msgs(2), { job: 'j' })
    assert.ok(results.every((r) => !r.ok && /RESEND_API_KEY/.test(r.reason)))
    assert.equal(h.rows.length, 2)
  } finally {
    __setEmailDepsForTests()
  }
})

test('classify / Retry-After / backoff rules', () => {
  assert.equal(classify(200), 'ok')
  assert.equal(classify(429), 'retry')
  assert.equal(classify(503), 'retry')
  assert.equal(classify(0), 'retry')
  for (const s of [400, 401, 403, 404, 409, 422]) assert.equal(classify(s), 'permanent')
  assert.equal(parseRetryAfter('3', 0), 3000)
  assert.equal(parseRetryAfter(null, 0), null)
  assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 4_000), 6_000)
  assert.ok(backoffMs(1, null, 0) === 500 && backoffMs(2, null, 0) === 1000 && backoffMs(4, null, 0) === 4000)
  assert.ok(backoffMs(1, null, 1) === 750, 'up to 50% jitter')
  assert.ok(backoffMs(9, null, 0) <= 30_000)
  assert.ok(backoffMs(1, 2000, 0) >= 2000, 'Retry-After wins')
})

test('recipientProblem: what Resend would refuse', () => {
  for (const ok of ['ali@gmail.com', 'a.b+tag@sub.example.co.uk', "o'neil@x.pk", '923001234567@users.tutormint.org']) {
    assert.equal(recipientProblem(ok), null, ok)
    assert.equal(looksLikeEmail(ok), true, ok)
  }
  for (const bad of ['', 'ali', 'ali@gmail', 'ali@@gmail.com', 'ali@gmail..com', '.ali@gmail.com', 'ali.@gmail.com', 'a b@gmail.com', 'ali@gmail.c', 'ali@-x.com', 'ali,b@gmail.com', 'ali@gmail.com.', 'علی@gmail.com']) {
    assert.notEqual(recipientProblem(bad), null, bad)
    assert.equal(looksLikeEmail(bad), false, bad)
  }
  assert.notEqual(recipientProblem(' ali@gmail.com'), null, 'surrounding spaces are a problem for the raw value')
  assert.equal(looksLikeEmail(' ali@gmail.com '), true, 'looksLikeEmail trims first, as before')
})

// ------------------------------------------------------------- one path --

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p)
  }
  return out
}

test('one send path: only lib/email/send.ts talks to Resend', () => {
  const files = ['app', 'components', 'lib'].flatMap((d) => walk(d))
  const offenders = files.filter((f) => {
    const s = readFileSync(f, 'utf8')
    return /api\.resend\.com/.test(s) || /from ['"]resend['"]/.test(s) || /\bnodemailer\b/.test(s)
  })
  assert.deepEqual(offenders.map((f) => f.replace(/\\/g, '/')), ['lib/email/send.ts'])
})

test('the bulk crons and fan-outs use the bulk path', () => {
  for (const f of ['lib/tuitionPause.ts', 'lib/payments/expiry.ts', 'lib/contentQueue/digest.ts', 'lib/matchEmail.ts', 'lib/tutorAlerts.ts', 'lib/switchedTutorEmail.ts']) {
    const s = readFileSync(f, 'utf8')
    assert.match(s, /deliverEmailBulk\(/, f)
    assert.doesNotMatch(s, /\bdeliverEmail\(/, `${f} still sends one by one`)
  }
})
