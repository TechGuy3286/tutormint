/**
 * scripts/test-sms-health.ts — SMS health (owner, 15 Oct 2026).
 *   npm run test:smshealth
 *
 * Every send path reaches the one adapter; the adapter reports failure when
 * SendPK rejects; "Send test SMS" is Owner-only; the alert fires on its two
 * conditions and keeps the 6-hour limit; no full number or code is recorded.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import {
  ALERT_COOLDOWN_MS,
  failureWindowStart,
  maskMobile,
  scrubSmsError,
  smsAlertDecision,
  smsAlertMessage,
  smsLogRow,
  smsTestBody,
  smsTestStamp,
} from '../lib/smsHealthCore'
import { otpDigits, parseSendpkBalance, sendpkProvider } from '../lib/sms/sendpk'
import { roleMayWrite, roleSatisfies, SCREEN_ACCESS } from '../lib/adminAccessCore'

const src = (p: string) => readFileSync(p, 'utf8')
const H = 60 * 60 * 1000

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(f)) out.push(p.replace(/\\/g, '/'))
  }
  return out
}

test('a number is recorded masked, never in full', () => {
  assert.equal(maskMobile('03211234522'), '0321•••••22')
  assert.equal(maskMobile('+92 321 1234522'), '0321•••••22')
  assert.equal(maskMobile('923211234522'), '0321•••••22')
  assert.equal(maskMobile('not a number'), '•••')
  assert.doesNotMatch(maskMobile('03211234522'), /\d{5,}/)
})

test('provider error text is scrubbed of numbers and codes', () => {
  assert.equal(scrubSmsError('12 : invalid number 923211045245'), '12 : invalid number •••')
  assert.equal(scrubSmsError('code 123456 rejected'), 'code ••• rejected')
  assert.equal(scrubSmsError('0321 1234522 blocked'), '••• blocked')
  assert.equal(scrubSmsError('1 : IP not whitelisted'), '1 : IP not whitelisted')
  assert.equal(scrubSmsError(''), null)
})

test('a log row holds no full number, no code and no message body', () => {
  const failed = smsLogRow({ purpose: 'verify', phone: '03211234522', outcome: 'failed', provider: 'sendpk', error: 'bad 923211234522 code 654321' })
  const blob = JSON.stringify(failed)
  assert.doesNotMatch(blob, /\d{6,}/)
  assert.equal(failed.to_masked, '0321•••••22')
  assert.ok(!('body' in failed) && !('code' in failed))
  const sent = smsLogRow({ purpose: 'signup', phone: '03211234522', outcome: 'sent', provider: 'sendpk', messageId: 'c409eb7d-24a8', error: 'ignored' })
  assert.equal(sent.error, null)
  assert.equal(sent.message_id, 'c409eb7d-24a8')
})

test('the test SMS fills SendPK\'s one template variable with the time, not a code', () => {
  const now = new Date('2026-10-15T06:48:30Z') // 11:48:30 PKT
  assert.equal(smsTestStamp(now), '114830')
  const body = smsTestBody(now)
  assert.equal(otpDigits(body), '114830', 'SendPK takes the first 4–8 digit run — it must be the stamp, not the year')
  assert.match(body, /TutorMint SMS test — 15 Oct 2026, 11:48 AM PKT/)
})

test('SendPK balance is the sum of the PKR package figures', () => {
  assert.equal(parseSendpkBalance('| Package# 1: 9570.40 PKR (2026-10-10) |'), 9570.4)
  assert.equal(parseSendpkBalance('| Package# 1: 60.00 PKR | Package# 2: 40.50 PKR |'), 100.5)
  assert.equal(parseSendpkBalance('1 : invalid api key'), null)
})

test('the adapter returns failure (not success) when SendPK rejects', async () => {
  const saved = { ...process.env }
  const realFetch = globalThis.fetch
  Object.assign(process.env, { SENDPK_API_KEY: 'k', SENDPK_SENDER: 's', SENDPK_TEMPLATE_ID: 't', SENDPK_BASE_URL: 'https://sendpk.example' })
  const warn = console.warn
  const info = console.info
  console.warn = () => {}
  console.info = () => {}
  try {
    globalThis.fetch = (async () => new Response('1 : invalid api key', { status: 200 })) as typeof fetch
    const bad = await sendpkProvider.send('03211234522', 'Your TutorMint verification code is 123456. tutormint.org')
    assert.equal(bad.ok, false)
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: 'true', results: [{ status: 'NO', messageid: 'x' }] }), { status: 200 })) as typeof fetch
    assert.equal((await sendpkProvider.send('03211234522', 'code 123456')).ok, false)
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: 'true', results: [{ status: 'OK', messageid: 'm-1' }] }), { status: 200 })) as typeof fetch
    const good = await sendpkProvider.send('03211234522', 'code 123456')
    assert.equal(good.ok, true)
    globalThis.fetch = (async () => {
      throw new Error('network down')
    }) as typeof fetch
    assert.equal((await sendpkProvider.send('03211234522', 'code 123456')).ok, false)
  } finally {
    globalThis.fetch = realFetch
    console.warn = warn
    console.info = info
    process.env = saved
  }
})

test('every send path reaches the adapter through sendSms()', () => {
  const log = src('lib/smsLog.ts')
  assert.match(log, /export async function sendSms[\s\S]*getSmsProvider\(\)[\s\S]*provider\.send\(o\.to, o\.body\)[\s\S]*recordSms\(/)

  const otp = src('lib/otp.ts')
  assert.match(otp, /await sendSms\(\{ to: phone, body: otpMessage\(code\), purpose: logPurpose \}\)/)
  assert.doesNotMatch(otp, /provider\.send\(/, 'deliverCode must not bypass sendSms')
  // Both OTP flows (signed-in verify / change mobile / onboarding, and reset) go through sendOtp → deliverCode.
  assert.match(src('app/api/auth/otp/route.ts'), /sendOtp\(\{ phone, purpose: 'verify'/)
  assert.match(src('app/api/auth/reset/route.ts'), /sendOtp\(\{ phone: msisdn, purpose: 'reset'/)
  // The signup code: register → startPendingSignup → deliverCode(…, 'signup').
  assert.match(src('app/api/auth/register/route.ts'), /startPendingSignup\(/)
  assert.match(src('lib/pendingSignup.ts'), /deliverCode\(opts\.mobile, code, 'verify', 'signup'\)/)
  // Search alerts.
  assert.match(src('lib/tutorAlerts.ts'), /sendSms\(\{ to: r\.contact, body: alertSms\(r\.label, url\), purpose: 'alert' \}\)/)
  // The test SMS.
  assert.match(src('app/api/admin/sms/test/route.ts'), /sendSms\(\{ to: msisdn, body: smsTestBody\(now\), purpose: 'test'/)

  // No other file calls the provider's send directly.
  const offenders = [...walk('app'), ...walk('lib')].filter((f) => {
    if (f === 'lib/smsLog.ts' || f.startsWith('lib/sms/')) return false
    return /getSmsProvider\(\)\.send|sendpkProvider\.send|consoleProvider\.send/.test(src(f))
  })
  assert.deepEqual(offenders, [])
})

test('"Send test SMS" is Owner only; the Partner views', () => {
  const a = SCREEN_ACCESS.smsHealth
  assert.equal(roleMayWrite('owner', a), true)
  for (const r of ['partner', 'admin', 'operations', 'tuitions_staff'] as const) assert.equal(roleMayWrite(r, a), false, r)
  assert.equal(roleSatisfies('partner', a), true, 'Partner may view')
  for (const r of ['admin', 'operations', 'tuitions_staff'] as const) assert.equal(roleSatisfies(r, a), false, r)
  const route = src('app/api/admin/sms/test/route.ts')
  const gate = route.indexOf('checkAdminRole(...SCREEN_ACCESS.smsHealth)')
  assert.ok(gate > 0 && gate < route.indexOf('await sendSms('), 'the gate runs before any send')
  assert.match(route, /rateLimit\('sms_test'/)
  assert.match(route, /logAdminAction\(/)
  assert.match(src('lib/rateLimit.ts'), /sms_test: \{ windowSeconds: 3600, max: 5 \}/)
})

test('the alert fires on a failure, and on 2+ code requests with no sends', () => {
  const now = Date.parse('2026-10-15T10:00:00Z')
  const base = { now, lastAlertAt: null, newFailures: 0, codeRequests12h: 0, successes12h: 0 }
  assert.equal(smsAlertDecision(base).fire, false)
  const failed = smsAlertDecision({ ...base, newFailures: 1, failedPurposes: ['verify'] })
  assert.equal(failed.fire, true)
  assert.match(failed.reasons[0], /1 SMS send attempt failed \(verify\)/)
  assert.equal(smsAlertDecision({ ...base, codeRequests12h: 2 }).fire, true)
  assert.equal(smsAlertDecision({ ...base, codeRequests12h: 1 }).fire, false)
  assert.equal(smsAlertDecision({ ...base, codeRequests12h: 5, successes12h: 1 }).fire, false)
})

test('at most one alert per 6 hours', () => {
  const now = Date.parse('2026-10-15T10:00:00Z')
  const f = { now, newFailures: 2, codeRequests12h: 0, successes12h: 0 }
  const held = smsAlertDecision({ ...f, lastAlertAt: now - 5 * H })
  assert.equal(held.fire, false)
  assert.equal(held.heldByCooldown, true)
  assert.equal(smsAlertDecision({ ...f, lastAlertAt: now - ALERT_COOLDOWN_MS }).fire, true)
  // Failures already alerted on are not counted again.
  assert.equal(failureWindowStart(now, now - 2 * H), now - 2 * H)
  assert.equal(failureWindowStart(now, null), now - 12 * H)
})

test('the alert message names the last successful SMS in Pakistan time', () => {
  assert.equal(
    smsAlertMessage('2026-10-13T17:22:00Z'),
    'SMS may not be sending — last successful SMS at 13 Oct 2026, 10:22 PM PKT. Check Admin → Settings → SMS.',
  )
  assert.match(smsAlertMessage(null), /never/)
})

test('nothing in the SMS log or test route logs a number', () => {
  for (const f of ['lib/smsLog.ts', 'app/api/admin/sms/test/route.ts', 'app/api/cron/sms-health/route.ts']) {
    for (const line of src(f).split('\n').filter((l) => /console\.(log|info|warn|error)/.test(l))) {
      assert.doesNotMatch(line, /\b(phone|msisdn|o\.to|to\b|body|code)\b/, `${f}: ${line.trim()}`)
    }
  }
})
