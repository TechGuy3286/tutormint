/**
 * scripts/test-admin-whatsapp.ts — npm run test:adminwhatsapp
 *
 * Every admin WhatsApp button opens a chat WITH a pre-filled message (owner,
 * 20 Oct 2026). Checks: the one builder makes
 * https://api.whatsapp.com/send?phone=92…&text=<encoded> (wa.me broke emoji —
 * 23 Oct 2026)
 * with emoji and line breaks encoded; numbers in any typed shape become 92…;
 * every member state gets a non-empty message; the other link builders admin
 * uses encode the same way; and no admin source file builds a bare wa.me link
 * to a member. Pure rules + a source scan; no DB, browser or network. The
 * numbers below are made up.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import {
  adminMemberMessage,
  adminWaLink,
  adminWhatsAppRoute,
  documentRejectedMessage,
  documentsWaitingMessage,
  parentHelpMessage,
  parseWhatsAppFrom,
  WHATSAPP_FROM,
} from '../lib/adminWhatsAppCore'
import { followUpMessage, type TutorFollowFacts } from '../lib/tutorFollowUpCore'
import { followUpWaLink } from '../lib/followUpCore'
import { waLink } from '../lib/staffOutreachCore'
import { forwardWaLink } from '../lib/applicantForwardCore'
import { whatsappHref } from '../lib/supportContacts'
import { waMeHref } from '../lib/documentsApprovedCore'

const NOW = Date.parse('2026-10-20T08:00:00Z')
const TEXT = 'Line one 🙂\nLine two & ?=#+ %'

function assertGoodLink(href: string | null, expectedText?: string) {
  assert.ok(href, 'a link')
  const m = /^https:\/\/api\.whatsapp\.com\/send\?phone=(92\d{10})&text=([^\s]+)$/.exec(href!)
  assert.ok(m, `api.whatsapp.com/send?phone=92…&text= form: ${href}`)
  const raw = m![2]
  assert.ok(raw.length > 0, 'text= is not empty')
  assert.ok(!/[\s\n#&?+]/.test(raw), 'nothing unencoded in the text value')
  const decoded = new URL(href!).searchParams.get('text')
  assert.ok(decoded && decoded.trim().length > 0)
  if (expectedText) assert.equal(decoded, expectedText)
}

function facts(over: Partial<TutorFollowFacts> = {}): TutorFollowFacts {
  return {
    feePaid: false,
    completion: 60,
    stoppedStep: 'cnic_photos',
    docsApproved: false,
    rejected: [],
    startedPayment: null,
    lastContactAt: null,
    ...over,
  }
}

test('numbers are normalised to 92… (no +, spaces or dashes)', () => {
  for (const raw of ['+92 300-1234567', '0300 1234567', '03001234567', '00923001234567', '923001234567', '3001234567']) {
    assert.equal(adminWaLink(raw, 'hi'), 'https://api.whatsapp.com/send?phone=923001234567&text=hi')
  }
  assert.equal(adminWaLink('12345', 'hi'), null)
  assert.equal(adminWaLink(null, 'hi'), null)
})

test('an empty message never makes a link', () => {
  assert.equal(adminWaLink('03001234567', ''), null)
  assert.equal(adminWaLink('03001234567', '   '), null)
})

test('emoji and line breaks are fully encoded', () => {
  const href = adminWaLink('0300 1234567', TEXT)
  assertGoodLink(href, TEXT)
  assert.ok(href!.includes('%0A'), 'line break encoded')
  assert.ok(href!.includes('%F0%9F%99%82'), 'emoji encoded')
  assert.ok(href!.includes('%26') && href!.includes('%3F') && href!.includes('%23') && href!.includes('%2B'))
})

test('the other admin link builders encode the same way', () => {
  assertGoodLink(followUpWaLink('923001234567', TEXT), TEXT) // Follow-ups, My sign-ups, Team activity lists
  assertGoodLink(waLink('923001234567', TEXT), TEXT) // Follow-ups → Tutors, Featured WhatsApp
  assertGoodLink(forwardWaLink('923001234567', TEXT), TEXT) // Applicants to forward
  assertGoodLink(whatsappHref('923001234567', TEXT), TEXT) // Team inbox, Message parent
  assertGoodLink(waMeHref('923001234567', TEXT), TEXT) // after documents approved
})

test('parents get the parent message', () => {
  const m = adminMemberMessage({ role: 'parent', name: 'ayesha khan', nowMs: NOW })
  assert.equal(m.type, 'parent_help')
  assert.equal(m.text, parentHelpMessage('ayesha khan'))
  // The fallback for a parent with no situation on record (owner, 27 Oct 2026):
  // a TutorMint link, no emoji. Real parents get their situation message
  // (lib/parentWhatsApp, tested in scripts/test-fee-match.ts).
  assert.match(m.text, /^Assalam o Alaikum ayesha, this is TutorMint\. Do you need any help finding a tutor\? You can post your requirement here:\n\nhttps:\/\/www\.tutormint\.org\/parent\/dashboard\/post-job$/)
})

test('a rejected document asks for a re-upload with the reason', () => {
  const m = adminMemberMessage({
    role: 'tutor',
    name: 'Sara Ali',
    tutor: { facts: facts({ rejected: [{ doc: 'selfie', reason: 'Face not clear.' }] }), docsWaiting: true },
    nowMs: NOW,
  })
  assert.equal(m.type, 'doc_rejected')
  assert.equal(
    m.text,
    'Assalam o Alaikum Sara, please re-upload your selfie (Face not clear). Reply here if you need help. 🙂\n\nhttps://www.tutormint.org/tutor/dashboard',
  )
  assert.equal(documentRejectedMessage('Sara', [{ doc: 'cnic', reason: null }]).includes('CNIC photos.'), true)
})

test('documents waiting name the next step', () => {
  const m = adminMemberMessage({ role: 'tutor', name: 'Sara Ali', tutor: { facts: facts({ stoppedStep: 'tagline' }), docsWaiting: true }, nowMs: NOW })
  assert.equal(m.type, 'docs_waiting')
  assert.equal(m.text, documentsWaitingMessage('Sara', 'write your tagline and bio'))
  assert.match(m.text, /We're checking them now\. Meanwhile, your next step is to write your tagline and bio\. Reply here if you need help\. 🙂\n\nhttps:\/\/www\.tutormint\.org\/tutor\/dashboard$/)
})

test('other tutor states use the Follow-ups messages', () => {
  const docsDone = adminMemberMessage({ role: 'tutor', name: 'Sara', tutor: { facts: facts({ stoppedStep: 'verify', docsApproved: true }), docsWaiting: false }, nowMs: NOW })
  assert.equal(docsDone.type, 'fee_due')
  const started = adminMemberMessage({
    role: 'tutor',
    name: 'Sara',
    tutor: { facts: facts({ startedPayment: { planCode: 'verified', startedAt: '2026-10-20T05:00:00Z' } }), docsWaiting: false },
    nowMs: NOW,
  })
  assert.equal(started.type, 'payment_unfinished')
  const stuck = adminMemberMessage({ role: 'tutor', name: 'Sara', tutor: { facts: facts(), docsWaiting: false }, nowMs: NOW })
  assert.equal(stuck.type, 'next_step')
  assert.equal(stuck.text, followUpMessage(facts(), 'Sara', NOW).text)
  const done = adminMemberMessage({ role: 'tutor', name: 'Sara', tutor: { facts: facts({ feePaid: true, stoppedStep: null }), docsWaiting: false }, nowMs: NOW })
  assert.equal(done.type, 'member_help')
  const staff = adminMemberMessage({ role: 'other', name: 'Ali', nowMs: NOW })
  assert.equal(staff.type, 'member_help')
})

test('every message makes a proper link, line breaks included', () => {
  const cases = [
    adminMemberMessage({ role: 'parent', name: 'A', nowMs: NOW }).text,
    adminMemberMessage({ role: 'tutor', name: 'A', tutor: { facts: facts({ rejected: [{ doc: 'photo', reason: 'blurry' }] }), docsWaiting: false }, nowMs: NOW }).text,
    adminMemberMessage({ role: 'tutor', name: 'A', tutor: { facts: facts(), docsWaiting: true }, nowMs: NOW }).text,
    // Follow-ups' re-upload variant carries a blank line.
    followUpMessage(facts({ rejected: [{ doc: 'cnic', reason: 'cut off' }] }), 'A', NOW).text,
  ]
  assert.ok(cases[3].includes('\n\n'))
  // The tutor messages keep their 🙂; the parent fallback has none (27 Oct 2026).
  for (const t of cases.slice(1)) assert.ok(t.includes('🙂'))
  assert.ok(!cases[0].includes('🙂'))
  for (const t of cases) assertGoodLink(adminWaLink('0321 0000000', t), t)
})

test('the route address carries the member and the screen', () => {
  const id = '11111111-1111-1111-1111-111111111111'
  for (const f of WHATSAPP_FROM) {
    const u = new URL(adminWhatsAppRoute(id, f), 'https://www.tutormint.org')
    assert.equal(u.pathname, '/api/admin/whatsapp')
    assert.equal(u.searchParams.get('memberId'), id)
    assert.equal(parseWhatsAppFrom(u.searchParams.get('from')), f)
  }
  assert.equal(parseWhatsAppFrom('nope'), null)
})

// ------------------------------------------------------------ source scan

function filesUnder(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...filesUnder(p))
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p)
  }
  return out
}

test('no admin screen builds a wa.me link to a member without text', () => {
  const offenders: string[] = []
  for (const f of [...filesUnder('app/admin'), ...filesUnder('components/admin')]) {
    const src = readFileSync(f, 'utf8')
    for (const line of src.split('\n')) {
      if (/^\s*(\/\/|\*)/.test(line)) continue
      // A link to a NUMBER with no text= on the same expression.
      if (/wa\.me\/\$\{/.test(line) && !/\?text=/.test(line)) offenders.push(`${f}: ${line.trim()}`)
    }
  }
  assert.deepEqual(offenders, [])
})

test('the previously blank buttons go through the route', () => {
  const read = (p: string) => readFileSync(p, 'utf8')
  // Through the AdminWhatsAppLink button since 27 Oct 2026 (POST, then the
  // same route; a parent's send is a follow-up with Undo).
  assert.match(read('components/admin/OverviewCardGrid.tsx'), /<AdminWhatsAppLink memberId=\{it\.memberId\} from="overview"/)
  assert.match(read('app/admin/users/[id]/MemberActions.tsx'), /<AdminWhatsAppLink memberId=\{userId\} from="member"/)
  assert.match(read('components/admin/WhatsappChatButton.tsx'), /<AdminWhatsAppLink\s+memberId=\{memberId\}\s+from=\{from\}/)
  assert.match(read('components/admin/AdminWhatsAppLink.tsx'), /adminWhatsAppRoute\(memberId, from\)/)
  assert.match(read('app/admin/users/MemberRow.tsx'), /<WhatsappChatButton memberId=\{r\.id\} from="people"/)
  assert.match(read('app/admin/tutors/videos/TutorModerationClient.tsx'), /<WhatsappChatButton memberId=\{t\.id\} from="tutor_queue"/)
  assert.match(read('app/admin/tutors/[id]/page.tsx'), /from="tutor_record"/)
  const route = read('app/api/admin/whatsapp/route.ts')
  assert.match(route, /action: 'member\.whatsapp_open'/)
  assert.match(route, /messageType: wa\.type/)
  assert.match(route, /NextResponse\.redirect\(r\.href/)
})
