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
