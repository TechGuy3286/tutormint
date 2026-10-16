// npm run test:switchedemail — the one-time "You can now sign in to TutorMint"
// email (owner, 13 Oct 2026): who gets it, that it can never send twice, and
// that a dry run sends and writes nothing. Offline: pure rules + source scans.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { planSwitchedEmails, switchedEmailSkip, SWITCHED_EMAIL_KEY, SWITCHED_EMAIL_SUBJECT, type SwitchedTutorFacts } from '../lib/switchedTutorEmailCore'
import { mayEmailAddress } from '../lib/emailConfirmCore'
import { render } from '../lib/notify/templates'

const read = (...p: string[]) => readFileSync(path.join(...p), 'utf8')

const tutor = (o: Partial<SwitchedTutorFacts> = {}): SwitchedTutorFacts => ({
  switched: true,
  role: 'tutor',
  adminRole: null,
  email: 'someone@example.com',
  mobileVerified: false,
  suspended: false,
  banned: false,
  selfPaused: false,
  isSeed: false,
  isTestName: false,
  hiddenFromPublic: false,
  alreadySent: false,
  ...o,
})

test('a switched email-only tutor is sent the email; everyone else is skipped', () => {
  assert.equal(switchedEmailSkip(tutor()), null)
  assert.equal(switchedEmailSkip(tutor({ switched: false })), 'not_switched')
  assert.equal(switchedEmailSkip(tutor({ mobileVerified: true })), 'mobile_verified')
  for (const o of [{ suspended: true }, { banned: true }, { selfPaused: true }]) assert.equal(switchedEmailSkip(tutor(o)), 'paused')
  for (const o of [{ isSeed: true }, { isTestName: true }, { hiddenFromPublic: true }, { adminRole: 'operations' }, { role: 'parent' }, { role: 'admin' }]) {
    assert.equal(switchedEmailSkip(tutor(o)), 'test_or_staff', JSON.stringify(o))
  }
  assert.equal(switchedEmailSkip(tutor({ email: '923001234567@users.tutormint.org' })), 'no_email')
  assert.equal(switchedEmailSkip(tutor({ email: '' })), 'no_email')
})

test('idempotent: once sent, a second run plans nothing for that tutor', () => {
  const rows = [
    { id: 'a', ...tutor() },
    { id: 'b', ...tutor() },
    { id: 'c', ...tutor({ mobileVerified: true }) },
    { id: 'd', ...tutor({ isTestName: true }) },
  ]
  const first = planSwitchedEmails(rows)
  assert.deepEqual(first.send, ['a', 'b'])
  assert.equal(first.skipped.mobile_verified, 1)
  assert.equal(first.skipped.test_or_staff, 1)
  // After the first run both are recorded as sent.
  const second = planSwitchedEmails(rows.map((r) => (first.send.includes(r.id) ? { ...r, alreadySent: true } : r)))
  assert.deepEqual(second.send, [])
  assert.equal(second.skipped.already_sent, 2)
  // The database refuses a second record for the same member and key.
  const sql = read('supabase', 'migrations', '170_partner_edit_areas_one_off_emails.sql')
  assert.ok(sql.includes('unique (user_id, email_key)'))
  // The record is written BEFORE the email leaves, and a refused record means "already sent".
  const lib = read('lib', 'switchedTutorEmail.ts')
  const claim = lib.indexOf(".from('one_off_emails').insert(")
  const send = lib.indexOf('await deliverEmailBulk(')
  assert.ok(claim > 0 && send > claim, 'recorded first, then sent')
  assert.ok(lib.includes('result.skipped.already_sent += 1'))
  assert.equal(SWITCHED_EMAIL_KEY, 'switched_tutor_signin_2026_10_13')
})

test('a dry run sends nothing and writes nothing', () => {
  const lib = read('lib', 'switchedTutorEmail.ts')
  const dry = lib.indexOf('if (opts.dryRun) return result')
  assert.ok(dry > 0)
  // Every write and the send come AFTER the dry-run return.
  for (const needle of [".insert(", '.delete()', 'await deliverEmailBulk(']) {
    assert.ok(lib.indexOf(needle) > dry, `${needle} is after the dry-run return`)
  }
  // loadFacts (the only code before it) reads only.
  const before = lib.slice(0, dry)
  assert.ok(!/\.(insert|update|upsert|delete)\(/.test(before))
  // The script must be told which: exactly one of --dry-run / --send.
  const script = read('scripts', 'send-switched-tutor-email.ts')
  assert.ok(script.includes("if (dryRun === send) throw new Error('Pass exactly one of --dry-run or --send.')"))
  assert.ok(script.includes('body: JSON.stringify({ dryRun })'))
  // The route needs CRON_SECRET and answers with counts only.
  const route = read('app', 'api', 'internal', 'switched-tutor-email', 'route.ts')
  assert.ok(route.includes('if (!cronAuthorised(request)) return NextResponse.json'))
  assert.ok(!/email:|full_name/.test(route))
})

test('the email: the owner’s subject, plain and short, no price, sign-in link and support number', () => {
  const m = render({ id: 'switched_tutor_signin', name: 'ayesha khan', supportWhatsapp: '0321 5872222' })
  assert.equal(m.subject, SWITCHED_EMAIL_SUBJECT)
  assert.equal(m.subject, 'You can now sign in to TutorMint')
  assert.equal(m.essential, true)
  for (const part of ['email address and the password you chose', 'add your mobile number and verify it', 'finish your profile', '0321 5872222', '/login']) {
    assert.ok(m.text.includes(part), part)
  }
  assert.ok(!/\bRs\b|PKR|\d{3,}\s*(?:rupees|\/month)|Premium|Featured|fee/i.test(m.text), 'no prices, no plans')
  assert.ok(m.text.split(/\s+/).length < 110, 'short')
})

test('this is the one extra email an unconfirmed address may receive', () => {
  const waiting = { email: 'a@example.com', pending: true }
  assert.equal(mayEmailAddress(waiting, 'switched_tutor_signin'), true)
  assert.equal(mayEmailAddress(waiting, 'confirm_email'), true)
  for (const id of ['welcome', 'plan_activated', 'tuition_match', 'admin_message']) assert.equal(mayEmailAddress(waiting, id), false, id)
})
