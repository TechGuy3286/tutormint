/**
 * scripts/test-push2.ts — npm run test:push2
 *
 * Push 2 of "Fast admin, Number first, cost and email clean-up" (owner, 1 Nov 2026):
 * the email-change security notice, and the fast admin lists + Overview summary.
 * Pure rules + source scans; no DB, browser or network. Addresses are made up.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { oldAddressNotice } from '../lib/emailChangeCore'
import { render } from '../lib/notify/templates'
import { CRITICAL_TEMPLATES, LOCKED_ON, MEMBER_TEMPLATES } from '../lib/email/policyCore'

const read = (p: string) => readFileSync(p, 'utf8')

test('email change: a real old address gets one masked notice', () => {
  assert.deepEqual(oldAddressNotice('Old.Person@Gmail.com', 'ayesha.khan@yahoo.com'), {
    to: 'old.person@gmail.com',
    maskedNew: 'ay•••@yahoo.com',
  })
})

test('email change: no notice for the mobile placeholder, an erased account, the same address or none', () => {
  assert.equal(oldAddressNotice('923001234567@users.tutormint.org', 'a.b@gmail.com'), null)
  assert.equal(oldAddressNotice('erased-11111111@users.tutormint.org', 'a.b@gmail.com'), null)
  assert.equal(oldAddressNotice('a.b@gmail.com', 'A.B@gmail.com'), null)
  assert.equal(oldAddressNotice(null, 'a.b@gmail.com'), null)
  assert.equal(oldAddressNotice('not an address', 'a.b@gmail.com'), null)
})

test('email change notice: the owner\'s words, no link, no undo', () => {
  const m = render({ id: 'email_changed_notice', maskedNew: 'ay•••@yahoo.com', supportWhatsapp: '0321 5872222' })
  assert.match(m.text, /Your TutorMint email was changed to ay•••@yahoo\.com\. Not you\? WhatsApp support: 0321 5872222\./)
  // The only link is the standard footer every email carries; no button, no undo.
  const links = m.text.match(/https?:\/\/\S+/g) ?? []
  assert.deepEqual(links, ['https://www.tutormint.org/account/notifications/settings'])
  assert.ok(!/undo|reverse|cancel/i.test(m.text + m.html))
  // A security notice always goes (critical, cannot be switched off) and is a member email.
  assert.ok(CRITICAL_TEMPLATES.has('email_changed_notice'))
  assert.ok(LOCKED_ON.has('email_changed_notice'))
  assert.ok((MEMBER_TEMPLATES as readonly string[]).includes('email_changed_notice'))
})

test('email change notice is sent once, when the change completes, to the old address', () => {
  const src = read('lib/emailConfirm.ts')
  const fn = src.slice(src.indexOf('async function completePendingChange'), src.indexOf('export async function confirmEmailFromLink'))
  assert.match(fn, /oldAddressNotice\(got\?\.user\?\.email, e\)/)
  assert.equal((fn.match(/email_changed_notice/g) ?? []).length, 1)
  // The new address keeps its single confirmation; the notice is never sent at request time.
  const req = src.slice(src.indexOf('export async function requestEmailChange'), src.indexOf('async function completePendingChange'))
  assert.ok(!req.includes('email_changed_notice'))
})
