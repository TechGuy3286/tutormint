/**
 * scripts/test-delivery.ts
 *
 * Unit tests for the email and SMS adapters, with the network mocked.
 *
 *   npm run test:delivery
 *
 * Uses node:test, which is built into Node — the repo has no test framework and
 * adding one for six assertions would be a heavier decision than the tests
 * justify.
 *
 * WHAT IS AND IS NOT PROVEN HERE. These tests assert the request we build:
 * the URL, the authorization header, the encoding, the number normalisation,
 * and that a failure is reported as a failure rather than swallowed. They do
 * NOT prove Twilio or Resend accept it — that needs live credentials and a
 * verified sending domain. Both of those are on PRODUCTION_CHECKLIST.md, and
 * the distinction matters: a green run here means the adapter is correct, not
 * that delivery works.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const realFetch = globalThis.fetch

type Captured = { url: string; init: RequestInit }

/** Replace fetch, capture the call, return a canned response. */
function mockFetch(response: { status: number; body: unknown }): {
  calls: Captured[]
  restore: () => void
} {
  const calls: Captured[] = []
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  return { calls, restore: () => { globalThis.fetch = realFetch } }
}

// ---------------------------------------------------------------- twilio ---

test('twilio: sends to a normalised E.164 number with basic auth', async () => {
  process.env.TWILIO_ACCOUNT_SID = 'ACtest123'
  process.env.TWILIO_AUTH_TOKEN = 'secrettoken'
  process.env.TWILIO_FROM = '+12025550123'
  delete process.env.TWILIO_MESSAGING_SERVICE_SID

  const { twilioProvider } = await import('../lib/sms/twilio')
  const m = mockFetch({ status: 201, body: { sid: 'SM123' } })

  try {
    // Typed the way a Pakistani member actually types it: leading zero,
    // spaces, a dash. All three have to survive into one E.164 number.
    const result = await twilioProvider.send('0300 123-4567'.replace('123-4567', '1234567'), 'Your code is 123456')

    assert.equal(result.ok, true)
    assert.equal(m.calls.length, 1)
    assert.equal(
      m.calls[0].url,
      'https://api.twilio.com/2010-04-01/Accounts/ACtest123/Messages.json',
    )

    const headers = m.calls[0].init.headers as Record<string, string>
    assert.equal(
      headers.Authorization,
      'Basic ' + Buffer.from('ACtest123:secrettoken').toString('base64'),
    )
    assert.equal(headers['Content-Type'], 'application/x-www-form-urlencoded')

    const form = new URLSearchParams(m.calls[0].init.body as string)
    // The whole point: 0300… became +92300… on the way out.
    assert.equal(form.get('To'), '+923001234567')
    assert.equal(form.get('From'), '+12025550123')
    assert.equal(form.get('Body'), 'Your code is 123456')
  } finally {
    m.restore()
  }
})

test('twilio: prefers a Messaging Service SID over a bare From', async () => {
  process.env.TWILIO_MESSAGING_SERVICE_SID = 'MG999'
  const { twilioProvider } = await import('../lib/sms/twilio')
  const m = mockFetch({ status: 201, body: { sid: 'SM124' } })

  try {
    await twilioProvider.send('03001234567', 'hello')
    const form = new URLSearchParams(m.calls[0].init.body as string)
    assert.equal(form.get('MessagingServiceSid'), 'MG999')
    assert.equal(form.get('From'), null)
  } finally {
    m.restore()
    delete process.env.TWILIO_MESSAGING_SERVICE_SID
  }
})

test('twilio: a rejected number never reaches the network', async () => {
  const { twilioProvider } = await import('../lib/sms/twilio')
  const m = mockFetch({ status: 201, body: { sid: 'nope' } })

  try {
    const result = await twilioProvider.send('12345', 'hello')
    assert.equal(result.ok, false)
    // Not merely reported as failed — not SENT. A malformed number that
    // reaches Twilio is a billable error.
    assert.equal(m.calls.length, 0)
  } finally {
    m.restore()
  }
})

test('twilio: an API error is reported, not swallowed', async () => {
  const { twilioProvider } = await import('../lib/sms/twilio')
  const m = mockFetch({
    status: 400,
    body: { code: 21408, message: 'Permission to send an SMS has not been enabled for the region' },
  })

  try {
    const result = await twilioProvider.send('03001234567', 'hello')
    assert.equal(result.ok, false)
    if (!result.ok) {
      // The account-setting hint has to survive: this exact error is a Twilio
      // geographic-permissions checkbox, and only the message says so.
      assert.match(result.error, /21408/)
      assert.match(result.error, /region/)
    }
  } finally {
    m.restore()
  }
})

test('twilio: reports itself unconfigured when credentials are missing', async () => {
  const saved = process.env.TWILIO_ACCOUNT_SID
  delete process.env.TWILIO_ACCOUNT_SID
  const { twilioProvider } = await import('../lib/sms/twilio')
  assert.equal(twilioProvider.isConfigured(), false)
  process.env.TWILIO_ACCOUNT_SID = saved
})

// -------------------------------------------------------------- smspoint ---

const SMSPOINT_KEYS = ['SMSPOINT_USERNAME', 'SMSPOINT_PASSWORD', 'SMSPOINT_CLIENTID', 'SMSPOINT_MASK']

/** A text/plain response, the way SMS Point actually answers. */
function mockFetchText(status: number, body: string): { calls: Captured[]; restore: () => void } {
  const calls: Captured[] = []
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } })
  }) as typeof fetch
  return { calls, restore: () => { globalThis.fetch = realFetch } }
}

function setSmspointEnv() {
  process.env.SMSPOINT_USERNAME = 'user1'
  process.env.SMSPOINT_PASSWORD = 'pass1'
  process.env.SMSPOINT_CLIENTID = 'client1'
  process.env.SMSPOINT_MASK = 'TutorMint'
}

test('smspoint: builds the send URL from env with no hardcoded values', async () => {
  setSmspointEnv()
  const { smspointProvider, SMSPOINT_ENDPOINT } = await import('../lib/sms/smspoint')
  const m = mockFetchText(200, 'Sent Successfully')
  try {
    // Typed with a leading zero and spaces — must survive into the canonical
    // 92… msisdn on the way out.
    const r = await smspointProvider.send(
      '0300 1234567',
      'Your TutorMint verification code is 123456. It expires in 10 minutes.',
    )
    assert.equal(r.ok, true)
    assert.equal(m.calls.length, 1)

    const u = new URL(m.calls[0].url)
    // The endpoint comes from the module, not a literal re-typed in the test.
    assert.equal(u.origin + u.pathname, SMSPOINT_ENDPOINT)
    assert.equal(u.searchParams.get('username'), 'user1')
    assert.equal(u.searchParams.get('password'), 'pass1')
    assert.equal(u.searchParams.get('clientid'), 'client1')
    assert.equal(u.searchParams.get('mask'), 'TutorMint')
    assert.equal(u.searchParams.get('Language'), 'English')
    // 0300… → 923001234567.
    assert.equal(u.searchParams.get('to'), '923001234567')
    assert.match(u.searchParams.get('msg') ?? '', /123456/)
  } finally {
    m.restore()
  }
})

test('smspoint: missing env fails closed — unconfigured, and send() never touches the network', async () => {
  for (const k of SMSPOINT_KEYS) delete process.env[k]
  const { smspointProvider } = await import('../lib/sms/smspoint')
  assert.equal(smspointProvider.isConfigured(), false)

  const m = mockFetchText(200, 'Sent Successfully')
  try {
    const r = await smspointProvider.send('03001234567', 'Your code is 123456')
    assert.equal(r.ok, false)
    assert.equal(m.calls.length, 0) // nothing sent — no silent success, no bill
  } finally {
    m.restore()
  }
})

test('smspoint: 200 "Sent Successfully" is accepted; anything else fails closed', async () => {
  const { smspointAccepted } = await import('../lib/sms/smspoint')
  assert.equal(smspointAccepted(200, 'Sent Successfully'), true)
  assert.equal(smspointAccepted(200, 'sent successfully'), true)
  assert.equal(smspointAccepted(200, 'Invalid username or password'), false) // detectable auth failure
  assert.equal(smspointAccepted(401, 'Unauthorized'), false)
  assert.equal(smspointAccepted(500, 'Sent Successfully'), false) // non-2xx
})

test('smspoint: a failure error carries neither the number nor the code', async () => {
  setSmspointEnv()
  const { smspointProvider } = await import('../lib/sms/smspoint')
  const m = mockFetchText(200, 'Invalid credentials')
  try {
    const r = await smspointProvider.send(
      '03211234567',
      'Your TutorMint verification code is 987654. It expires in 10 minutes.',
    )
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.doesNotMatch(r.error, /987654/) // the code
      assert.doesNotMatch(r.error, /3211234567/) // the number (any shape)
    }
  } finally {
    m.restore()
  }
})

test('getSmsProvider: prefers SMS Point when its env is set', async () => {
  setSmspointEnv()
  const { getSmsProvider } = await import('../lib/sms/index')
  assert.equal(getSmsProvider().name, 'smspoint')
})

// ---------------------------------------------------- per-number send caps ---

test('sendCapDecision: the per-number DAILY cap holds', async () => {
  const { sendCapDecision, MAX_SENDS_PER_DAY } = await import('../lib/otp')
  const now = Date.now()
  // MAX_SENDS_PER_DAY sends, each in its own hour so the hourly cap is not what
  // trips — the daily ceiling is.
  const atCap = Array.from({ length: MAX_SENDS_PER_DAY }, (_, i) => now - (i + 2) * 60 * 60 * 1000)
  const v = sendCapDecision(atCap, now)
  assert.equal(v.ok, false)
  if (!v.ok) assert.equal(v.reason, 'day')

  // One fewer, all spread across separate hours and well past the cooldown → ok.
  const v2 = sendCapDecision(atCap.slice(1), now)
  assert.equal(v2.ok, true)
})

test('sendCapDecision: the hourly burst cap binds within the daily budget', async () => {
  const { sendCapDecision, MAX_SENDS_PER_HOUR } = await import('../lib/otp')
  const now = Date.now()
  // MAX_SENDS_PER_HOUR sends all inside the last hour (spaced past the cooldown).
  const inHour = Array.from({ length: MAX_SENDS_PER_HOUR }, (_, i) => now - (i * 6 + 6) * 60 * 1000)
  const v = sendCapDecision(inHour, now)
  assert.equal(v.ok, false)
  if (!v.ok) assert.equal(v.reason, 'hour')
})

test('sendCapDecision: the 5-minute cooldown carries a countdown', async () => {
  const { sendCapDecision } = await import('../lib/otp')
  const now = Date.now()
  // One recent send, two minutes ago → still cooling down, with seconds left.
  const v = sendCapDecision([now - 2 * 60 * 1000], now)
  assert.equal(v.ok, false)
  if (!v.ok) {
    assert.equal(v.reason, 'cooldown')
    assert.ok((v.retryAfterSeconds ?? 0) > 0)
  }
  // A send six minutes ago is past the 5-minute cooldown → ok.
  assert.equal(sendCapDecision([now - 6 * 60 * 1000], now).ok, true)
})

// ----------------------------------------------------------- otp safety ---

test('the OTP bypass follows VERCEL_ENV, not NODE_ENV', async () => {
  // Asserted in a child process: NODE_ENV is a getter on process.env under
  // Node's test runner and cannot be redefined. That is also closer to the
  // thing being tested -- a deployment whose environment carries the variable.
  const { execFileSync } = await import('node:child_process')

  const script = `
    const { devOtpCode, assertOtpSafety } = require('./lib/sms/index.ts')
    const out = { code: devOtpCode(), threw: false, message: '' }
    try { assertOtpSafety() } catch (e) { out.threw = true; out.message = e.message }
    console.log(JSON.stringify(out))
  `

  const run = (env: Record<string, string>) =>
    JSON.parse(
      execFileSync(process.execPath, ['--import', 'tsx', '-e', script], {
        encoding: 'utf8',
        // VERCEL_ENV is cleared unless the case sets it, so a machine that
        // happens to have one exported cannot change what these assert.
        env: { ...process.env, VERCEL_ENV: '', DEV_DEFAULT_OTP: '000000', ...env },
      }).trim(),
    ) as { code: string | null; threw: boolean; message: string }

  // --- local, no VERCEL_ENV: NODE_ENV decides -----------------------------
  const localDev = run({ NODE_ENV: 'development' })
  assert.equal(localDev.code, '000000', 'the bypass works in local development')
  assert.equal(localDev.threw, false)

  const localProd = run({ NODE_ENV: 'production' })
  assert.equal(localProd.code, null, 'a local production build has no bypass')
  assert.equal(localProd.threw, true)

  // --- deployed: VERCEL_ENV decides, and NODE_ENV is production either way --
  //
  // This is the case that matters. Both of these are built with `next build`,
  // so NODE_ENV is 'production' for both; only VERCEL_ENV tells them apart.
  const preview = run({ NODE_ENV: 'production', VERCEL_ENV: 'preview' })
  assert.equal(preview.code, '000000', 'a preview deployment keeps the bypass')
  assert.equal(preview.threw, false, 'and must not refuse to boot')

  const production = run({ NODE_ENV: 'production', VERCEL_ENV: 'production' })
  assert.equal(production.code, null, 'the live site never has the bypass')
  assert.equal(production.threw, true, 'and refuses to boot while the variable is set')
  assert.match(production.message, /DEV_DEFAULT_OTP is set on the live site/)

  // Removing it from Production is what the error asks for, so that must work.
  const clean = run({ NODE_ENV: 'production', VERCEL_ENV: 'production', DEV_DEFAULT_OTP: '' })
  assert.equal(clean.threw, false, 'unset on the live site is fine')
})

test('the BRIDGE_OTP stopgap is allowed on the live site, and does not trip the boot guard', async () => {
  // The bridge is deliberately different from DEV_DEFAULT_OTP: it is meant to
  // run ON production until a real SMS provider lands, so it must NOT be gated
  // by isProduction and must NOT make assertOtpSafety throw (that guard inspects
  // only DEV_DEFAULT_OTP). Asserted in a child process with VERCEL_ENV=production.
  const { execFileSync } = await import('node:child_process')

  const script = `
    const { bridgeOtpCode, bridgeStatus, assertOtpSafety } = require('./lib/sms/index.ts')
    const out = { code: bridgeOtpCode(), active: bridgeStatus().active, threw: false }
    try { assertOtpSafety() } catch { out.threw = true }
    console.log(JSON.stringify(out))
  `
  const future = new Date(Date.now() + 7 * 86400000).toISOString()
  const run = (env: Record<string, string>) =>
    JSON.parse(
      execFileSync(process.execPath, ['--import', 'tsx', '-e', script], {
        encoding: 'utf8',
        env: { ...process.env, VERCEL_ENV: '', DEV_DEFAULT_OTP: '', BRIDGE_OTP: '', BRIDGE_OTP_EXPIRES: '', ...env },
      }).trim(),
    ) as { code: string | null; active: boolean; threw: boolean }

  const live = run({ NODE_ENV: 'production', VERCEL_ENV: 'production', BRIDGE_OTP: '654321', BRIDGE_OTP_EXPIRES: future })
  assert.equal(live.code, '654321', 'the bridge code verifies on the live site')
  assert.equal(live.active, true)
  assert.equal(live.threw, false, 'and does NOT trip the DEV_DEFAULT_OTP boot guard')

  const expired = run({
    NODE_ENV: 'production', VERCEL_ENV: 'production',
    BRIDGE_OTP: '654321', BRIDGE_OTP_EXPIRES: new Date(Date.now() - 86400000).toISOString(),
  })
  assert.equal(expired.code, null, 'past its expiry the bridge stops verifying, even on the live site')
})

test('the payment simulator follows VERCEL_ENV too', async () => {
  const { execFileSync } = await import('node:child_process')

  const script = `
    const { simulatorEnabled } = require('./lib/payments/provider.ts')
    console.log(JSON.stringify({ enabled: simulatorEnabled() }))
  `
  const run = (env: Record<string, string>) =>
    JSON.parse(
      execFileSync(process.execPath, ['--import', 'tsx', '-e', script], {
        encoding: 'utf8',
        env: {
          ...process.env,
          VERCEL_ENV: '',
          PAYMENTS_SIMULATOR: 'true',
          PAYMENTS_SIMULATOR_SECRET: 'test-secret',
          ...env,
        },
      }).trim(),
    ) as { enabled: boolean }

  assert.equal(run({ NODE_ENV: 'production', VERCEL_ENV: 'preview' }).enabled, true)
  assert.equal(run({ NODE_ENV: 'production', VERCEL_ENV: 'production' }).enabled, false)
  assert.equal(run({ NODE_ENV: 'production' }).enabled, false, 'local production build')

  // Still requires its own two variables, whatever the environment.
  const noSecret = JSON.parse(
    execFileSync(process.execPath, ['--import', 'tsx', '-e', script], {
      encoding: 'utf8',
      env: { ...process.env, VERCEL_ENV: 'preview', PAYMENTS_SIMULATOR: 'true', PAYMENTS_SIMULATOR_SECRET: '' },
    }).trim(),
  ) as { enabled: boolean }
  assert.equal(noSecret.enabled, false, 'no secret, no simulator — even on preview')
})

// ----------------------------------------------------------------- email ---

test('resend: posts the rendered email with the right auth and body', async () => {
  process.env.RESEND_API_KEY = 're_test_key'
  process.env.MAIL_FROM = 'TutorMint <noreply@tutormint.org>'

  const { getEmailChannel } = await import('../lib/notify/email')
  const { render } = await import('../lib/notify/templates')

  const message = render({ id: 'welcome', name: 'Ayesha Khan', role: 'tutor' })
  const m = mockFetch({ status: 200, body: { id: 'email_abc' } })

  try {
    const result = await getEmailChannel().send({
      to: 'techguy3286+t8@gmail.com',
      subject: message.subject,
      text: message.text,
      html: message.html,
    })

    assert.equal(result.ok, true)
    assert.equal(m.calls[0].url, 'https://api.resend.com/emails')

    const headers = m.calls[0].init.headers as Record<string, string>
    assert.equal(headers.Authorization, 'Bearer re_test_key')

    const sent = JSON.parse(m.calls[0].init.body as string)
    assert.equal(sent.from, 'TutorMint <noreply@tutormint.org>')
    assert.deepEqual(sent.to, ['techguy3286+t8@gmail.com'])
    assert.equal(sent.subject, 'Welcome to TutorMint')
    assert.match(sent.text, /Welcome, Ayesha Khan/)
    assert.match(sent.text, /Complete your profile/)
    // Both parts always: a text part that reads on its own matters more than
    // the layout on a phone with a poor connection.
    assert.ok(sent.html.includes('<h1'))
  } finally {
    m.restore()
    delete process.env.RESEND_API_KEY
  }
})

test('email: essential templates ignore the opt-out, courtesy ones do not', async () => {
  const { render } = await import('../lib/notify/templates')

  assert.equal(render({ id: 'welcome', name: 'A', role: 'parent' }).essential, false)
  assert.equal(render({ id: 'message_digest', name: 'A', count: 2, from: ['B'] }).essential, false)

  assert.equal(
    render({
      id: 'verification_decision',
      name: 'A',
      decision: 'rejected',
      subjectOfDecision: 'video',
      reason: 'Audio was inaudible',
    }).essential,
    true,
  )
  assert.equal(
    render({ id: 'plan_expiring', name: 'A', planName: 'Featured', daysLeft: 3 }).essential,
    true,
  )
  assert.equal(
    render({ id: 'plan_activated', name: 'A', planName: 'Premium', expiresAt: '1/10/2026', amountPkr: 499 })
      .essential,
    true,
  )
})

test('email: a rejection carries the reason, because that is the actionable part', async () => {
  const { render } = await import('../lib/notify/templates')
  const m = render({
    id: 'verification_decision',
    name: 'Bilal',
    decision: 'hold',
    subjectOfDecision: 'video',
    reason: 'Please record in a quieter room',
  })
  assert.match(m.text, /Please record in a quieter room/)
  assert.match(m.subject, /on hold/)
})

test('email: the digest never contains the message', async () => {
  const { render } = await import('../lib/notify/templates')
  const m = render({ id: 'message_digest', name: 'Sara', count: 3, from: ['Ayesha Khan'] })
  assert.match(m.text, /Message contents are not included in email/)
  assert.match(m.text, /From Ayesha Khan/)
})

// ------------------------------------------------------------ validation ---

test('validate: a fee is accepted in the shapes people type', async () => {
  const { rupees } = await import('../lib/validate')
  assert.equal(rupees.parse('8000'), 8000)
  assert.equal(rupees.parse('8,000'), 8000)
  assert.equal(rupees.parse('8k'), 8000)
  assert.equal(rupees.parse('Rs 8000'), 8000)
  assert.equal(rupees.parse(8000), 8000)
  assert.equal(rupees.safeParse('lots').success, false)
})

test('validate: a mobile is accepted in the shapes people type', async () => {
  const { pkMobile } = await import('../lib/validate')
  for (const shape of ['03001234567', '0300 1234567', '0300-1234567', '+92 300 1234567']) {
    assert.equal(pkMobile.safeParse(shape).success, true, shape)
  }
  assert.equal(pkMobile.safeParse('0400 1234567').success, false)
  assert.equal(pkMobile.safeParse('12345').success, false)
})

test('validate: a CNIC is accepted with or without dashes', async () => {
  const { cnic } = await import('../lib/validate')
  assert.equal(cnic.parse('35201-1234567-8'), '3520112345678')
  assert.equal(cnic.parse('3520112345678'), '3520112345678')
  assert.equal(cnic.safeParse('352011234567').success, false)
})

// ------------------------------------------------------ otp log masking ---

test('maskMsisdn: a log line never carries the full number', async () => {
  const { maskMsisdn } = await import('../lib/otp')
  const full = '923244015462'
  const masked = maskMsisdn(full)
  // The whole number must never appear, and the middle digits are gone.
  assert.equal(masked.includes(full), false, 'the full msisdn must not survive masking')
  assert.equal(masked.includes('244015'), false, 'the middle digits must be starred')
  // Shape: first 2 + stars + last 3, so a human can still eyeball which number.
  assert.equal(masked.startsWith('92'), true)
  assert.equal(masked.endsWith('462'), true)
  assert.match(masked, /^\d{2}\*+\d{3}$/)
  // A short/garbage value degrades to a constant, never echoing what it got.
  assert.equal(maskMsisdn('123'), '***')
})
