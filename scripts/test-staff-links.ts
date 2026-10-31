// scripts/test-staff-links.ts — Staff links with a hidden code (owner, 23 Oct 2026).
//   npm run test:stafflinks
// Pure rules (lib/staffSignupsCore, lib/waLinkCore, lib/social/copy) plus source
// checks that the pages and routes use them.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import {
  CREDIT_MS,
  creditRefusal,
  joinRefPath,
  myLinkCounts,
  normaliseStaffCode,
  onJoinLink,
  onStaffCode,
  refFromSearch,
  sourceRow,
  visitExpiry,
  visitValid,
  withoutRef,
  type AccountFacts,
  type CreditedAccount,
  type Visit,
} from '../lib/staffSignupsCore'
import { addRefToUrl, finishWaText, waHrefWithRef, waSendHref, withStaffRef } from '../lib/waLinkCore'
import { captionVariants, type SocialData } from '../lib/social/copy'

const read = (p: string) => readFileSync(p, 'utf8')
const NOW = Date.parse('2026-10-23T09:00:00Z')
const refs = (s: string) => (s.match(/[?&]ref=/gi) ?? []).length

// ------------------------------------------------------------ Part A: ?ref

test('?ref is read on any page, in any case, and an unusable value is ignored', () => {
  assert.equal(refFromSearch('?ref=aqsa'), 'AQSA')
  assert.equal(refFromSearch('?city=Lahore&ref=Aqsa&x=1'), 'AQSA')
  assert.equal(refFromSearch('?ref='), null)
  assert.equal(refFromSearch('?ref=a'), null)
  assert.equal(refFromSearch('?city=Lahore'), null)
  assert.equal(normaliseStaffCode('not a real code that is far too long to be one'), null)
})

test('the address bar is cleaned: ref removed, everything else kept, no reload', () => {
  assert.equal(withoutRef('/tuitions/lahore/x-abc123', '?ref=AQSA'), '/tuitions/lahore/x-abc123')
  assert.equal(withoutRef('/browse/tutors', '?city=Lahore&ref=AQSA', '#top'), '/browse/tutors?city=Lahore#top')
  assert.equal(withoutRef('/', '?ref=AQSA&next=%2Fpay'), '/?next=%2Fpay')
  const capture = read('components/StaffRefCapture.tsx')
  assert.match(capture, /history\.replaceState\(/)
  assert.match(capture, /withoutRef\(/)
  assert.doesNotMatch(capture, /location\.(?:reload|assign|replace)\(/, 'never reloads')
  assert.match(read('components/SiteChrome.tsx'), /<StaffRefCapture \/>/, 'mounted on every public page')
})

test('first link wins, and a stored credit lasts 30 days', () => {
  const v: Visit = { id: '1', staffId: 'a', createdAt: new Date(NOW).toISOString(), expiresAt: visitExpiry(NOW) }
  assert.equal(CREDIT_MS, 30 * 86_400_000)
  assert.equal(onJoinLink(v, NOW + 29 * 86_400_000), 'keep')
  assert.equal(onStaffCode(v, true, NOW + 29 * 86_400_000), 'keep')
  assert.equal(visitValid(v, NOW + 30 * 86_400_000 + 1), false)
  assert.equal(onJoinLink(v, NOW + 31 * 86_400_000), 'record')
  assert.equal(onStaffCode(null, false, NOW), 'ignore', 'an unknown code is ignored')
})

test('/api/ref and /join record a "link" credit and answer the same whatever the code', () => {
  const api = read('app/api/ref/route.ts')
  assert.match(api, /refLinkVisit\(/)
  assert.match(api, /status: 204/)
  assert.doesNotMatch(api, /status: 4\d\d/, 'an unknown code gets the same answer')
  assert.match(api, /isBotUserAgent/)
  const joinRoute = read('app/join/route.ts')
  assert.match(joinRoute, /refLinkVisit\(/)
  assert.match(joinRoute, /new URL\('\/register'/)
  assert.match(joinRoute, /dest\.searchParams\.set\(REF_PARAM, code\)/, '/join keeps ?ref on the way to sign-up')
  assert.match(joinRoute, /X-Robots-Tag', 'noindex'/)
  const lib = read('lib/staffSignups.ts')
  assert.match(lib, /export function refLinkVisit[\s\S]{0,200}staffCodeVisit\(rawCode, cookieValue, nowMs, 'link'\)/)
  assert.match(lib, /source: 'link' \| 'code' = 'code'/, 'the old code box stays source "code"')
  assert.match(lib, /if \(!staffId\) return \{ visit: null, recorded: false \}/, 'an unknown or inactive code records nothing')
  assert.match(read('app/robots.ts'), /'\/join',/)
})

test('the personal link is /join?ref=<CODE>', () => {
  assert.equal(joinRefPath('aqsa'), '/join?ref=AQSA')
  assert.match(read('lib/staffSignups.ts'), /absoluteUrl\(joinRefPath\(r\.code\)\)/)
})

test('canonical tags never carry ?ref', () => {
  const files: string[] = []
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(tsx?|mjs)$/.test(n)) files.push(p)
    }
  }
  for (const d of ['app', 'components', 'lib']) walk(d)
  let seen = 0
  for (const f of files) {
    for (const line of read(f).split('\n')) {
      if (!/\bcanonical:\s*\S/.test(line) || /^\s*(\/\/|\*)/.test(line) || /canonical: (string|null)/.test(line) || /canonical: m \?/.test(line)) continue
      seen++
      assert.doesNotMatch(line, /\bref\b|searchParams|\bsp\.(?!city)|\bparams\.get\(/i, `${f}: ${line.trim()}`)
    }
  }
  assert.ok(seen >= 5, 'the canonical tags were found')
})

// ------------------------------------------------------- sign-up paths

test('every sign-up path attaches the stored code: refCode is "link", an old ?code is "code"', () => {
  const route = read('app/api/auth/register/route.ts')
  assert.match(route, /refCode: z\.string\(\)\.trim\(\)\.max\(40\)\.optional\(\)/)
  assert.match(route, /\[body\.refCode, refLinkVisit\],\s*\[body\.staffCode, staffCodeVisit\]/)
  // Email sign-ups (tutor and parent) are credited in the register route; mobile ones at verify.
  assert.ok((route.match(/creditNewAccount\(/g) ?? []).length >= 2)
  assert.match(read('app/api/auth/register/verify/route.ts'), /creditNewAccount\(result\.userId, jar\.get\(STAFF_REF_COOKIE\)/)
  const page = read('app/(site)/register/page.tsx')
  assert.match(page, /const \{ next, role, ref, code \} = await searchParams/)
  assert.match(page, /initialRefCode=\{refCode\} initialStaffCode=\{staffCode\}/)
  const form = read('app/(site)/register/RegisterForm.tsx')
  assert.match(form, /\.\.\.\(refCode \? \{ refCode \} : \{\}\)/)
  assert.match(form, /\.\.\.\(staffCode \? \{ staffCode \} : \{\}\)/, 'old ?code links still credit')
})

test('the sign-up form has no Staff code box', () => {
  const form = read('app/(site)/register/RegisterForm.tsx')
  assert.doesNotMatch(form, /Staff code/i)
  assert.doesNotMatch(form, /id="staffCode"/)
  assert.doesNotMatch(form, /setStaffCode/)
})

test('staff and test accounts are never credited, even for their own sign-ups', () => {
  const base: AccountFacts = {
    id: 'm',
    role: 'tutor',
    createdAt: new Date(NOW).toISOString(),
    mobiles: ['923001234567'],
    email: 'person@example.com',
    isTest: false,
    isDuplicate: false,
    alreadyCredited: false,
  }
  const staff = { mobiles: new Set(['923009999999']), emails: new Set(['staff@example.com']) }
  assert.equal(creditRefusal(base, staff), null)
  assert.equal(creditRefusal({ ...base, isTest: true }, staff), 'test')
  assert.equal(creditRefusal({ ...base, role: 'admin' }, staff), 'not_member')
  assert.equal(creditRefusal({ ...base, mobiles: ['923009999999'] }, staff), 'staff_contact')
  assert.equal(creditRefusal({ ...base, email: 'STAFF@example.com' }, staff), 'staff_contact')
})

// ------------------------------------------------------- Part C: messages

test('every site link in a message gets the sender ref exactly once', () => {
  const text = 'Hi Ali, continue here: tutormint.org/pay/choose. Or see https://www.tutormint.org/tuitions/lahore/x-abc123?apply=1#top.'
  const out = withStaffRef(text, 'aqsa')
  assert.match(out, /tutormint\.org\/pay\/choose\?ref=AQSA\./)
  assert.match(out, /x-abc123\?apply=1&ref=AQSA#top\./)
  assert.equal(refs(out), 2)
  assert.equal(withStaffRef(out, 'aqsa'), out, 'applied twice: still once')
  assert.equal(withStaffRef(out, 'zubia'), out, 'a link that already has a ref keeps it')
  const finished = finishWaText('Your profile: https://www.tutormint.org/tutor/ali', 'AQSA')
  assert.equal(finished, 'Your profile:\nhttps://www.tutormint.org/tutor/ali?ref=AQSA')
  const body = new URL(waSendHref('923001234567', finished, 'AQSA')).searchParams.get('text')!
  assert.equal(refs(body), 1)
  // A ready-made link rebuilt with the viewer's code (rows cached for every viewer).
  const plain = waSendHref('923001234567', 'See https://www.tutormint.org/tutor/ali')
  const rebuilt = waHrefWithRef(plain, 'AQSA')!
  assert.equal(new URL(rebuilt).searchParams.get('text'), 'See https://www.tutormint.org/tutor/ali?ref=AQSA')
  assert.equal(new URL(rebuilt).searchParams.get('phone'), '923001234567')
  assert.equal(waHrefWithRef(rebuilt, 'AQSA'), rebuilt)
  // Not a site link: untouched.
  assert.equal(withStaffRef('Email jobs@users.tutormint.org or visit example.com', 'AQSA'), 'Email jobs@users.tutormint.org or visit example.com')
})

test('a sender with no code (the site Owner) adds nothing', () => {
  const t = 'https://www.tutormint.org/register'
  assert.equal(withStaffRef(t, null), t)
  assert.equal(finishWaText(t, null), t)
  assert.equal(addRefToUrl(t, ''), t)
  const lib = read('lib/staffSignups.ts')
  assert.match(lib, /export const senderRefCode = cache\(/)
  assert.match(lib, /if \(!p \|\| !isActiveParticipant\(/, 'only staff who still earn credit')
})

test('every staff WhatsApp builder passes the sender code', () => {
  const checks: [string, RegExp][] = [
    ['lib/adminWhatsAppCore.ts', /finishWaText\(text \?\? '', refCode\)/],
    ['lib/followUpCore.ts', /finishWaText\(text, refCode\)/],
    ['lib/staffOutreachCore.ts', /finishWaText\(text, refCode\)/],
    ['lib/applicantForwardCore.ts', /waSendHref\(msisdn, finishWaText\(message, refCode\), refCode\)/],
    ['lib/documentsApprovedCore.ts', /finishWaText\(text, refCode\)/],
    ['lib/unmetSearchCore.ts', /waSendHref\(null, text, refCode\)/],
    // Since 27 Oct 2026 the route builds through build(); a parent's message is
    // lib/parentWhatsApp, which reads the sender's code itself.
    ['app/api/admin/whatsapp/route.ts', /senderRefCode\(actor\.id\)/],
    ['lib/parentWhatsApp.ts', /senderRefCode\(actor\.id\)/],
    ['app/api/admin/applications/whatsapp/route.ts', /senderRefCode\(gate\.actor\.id\)/],
    ['app/api/admin/documents-approved/route.ts', /senderRefCode\(gate\.actor\.id\)/],
    ['lib/applicationFollowUps.ts', /adminWaLink\(raw, text, await senderRefCode\(actor\.id\)\)[\s\S]*adminWaLink\(raw, text, await senderRefCode\(actor\.id\)\)/],
    ['lib/staffOutreach.ts', /sendNow\), await senderRefCode\(actor\.id\)\)/],
    ['lib/adminMessaging.ts', /whatsappHref\(msisdn, body, await senderRefCode\(params\.actor\.id\)\)[\s\S]*whatsappHref\(msisdn, finishWaText\(filled, seededRef\), seededRef\)/],
    ['lib/mySignups.ts', /rowsForAccounts\(mine, await senderRefCode\(staffId\)\)/],
    ['app/admin/follow-ups/page.tsx', /waHrefWithRef\(r\.waHref, refCode\)[\s\S]*feeReplyHref: waHrefWithRef\(r\.feeReplyHref, refCode\)/],
    ['app/admin/applications/ForwardToParents.tsx', /forwardWaLink\(card\.parent\.msisdn, message, refCode\)/],
    ['app/admin/overview/todo-unmet/UnmetSearchesClient.tsx', /whatsappShareLink\(post, refCode\)/],
    ['components/admin/FollowUpActions.tsx', /waHrefWithRef\(p\.waHref, refCode\)/],
    ['components/admin/TutorFollowUpButtons.tsx', /waHrefWithRef\(p\.feeReplyHref, refCode\)[\s\S]*waHrefWithRef\(p\.waHref, refCode\)/],
    ['components/admin/TutorDocumentReview.tsx', /waSendHref\(waMsisdn, text, refCode\)/],
    ['components/admin/ParentDocumentReview.tsx', /waSendHref\(waMsisdn, finishWaText\(text, refCode\), refCode\)/],
    ['app/admin/layout.tsx', /refCode=\{refCode\}/],
  ]
  for (const [f, re] of checks) assert.match(read(f), re, f)
})

test('social captions and the QR use the staff member code; Copy link buttons too', () => {
  const data: SocialData = {
    slug: 'ali',
    name: 'Ali Raza',
    badges: [],
    subjects: [],
    ratingAvg: null,
    ratingCount: null,
    experienceYears: null,
    teachingMode: null,
    city: 'Lahore',
    area: null,
    profileUrl: 'https://www.tutormint.org/tutor/ali',
    refCode: 'AQSA',
  }
  for (const c of captionVariants('verified', data)) {
    assert.ok(c.includes('https://www.tutormint.org/tutor/ali?ref=AQSA'))
    assert.equal(refs(c), 1)
  }
  for (const c of captionVariants('verified', { ...data, refCode: null })) assert.equal(refs(c), 0)
  const route = read('app/api/admin/social/image/route.tsx')
  assert.match(route, /cvQrDataUri\(addRefToUrl\(post\.profileUrl, refCode\)\)/)
  assert.match(route, /profileUrl: post\.profileUrl,/, 'the address printed on the image stays clean')
  assert.match(read('app/admin/social/SocialClient.tsx'), /const refCode = useStaffRefCode\(\)/)
  assert.match(read('components/admin/ProfileShareButtons.tsx'), /addRefToUrl\(share\.url, refCode\)/)
  assert.match(read('components/admin/blog/BlogAdminList.tsx'), /addRefToUrl\(url, refCode\)/)
  assert.match(read('components/admin/blog/PostEditor.tsx'), /addRefToUrl\(`\$\{SITE_URL\}\$\{postPath\(post\.slug\)\}`, refCode\)/)
})

// ------------------------------------------------------- Part D: My link

let n = 0
function acct(over: Partial<CreditedAccount> & { at: CreditedAccount['at'] }): CreditedAccount {
  return { memberId: `m${n++}`, staffId: 'aqsa', role: 'tutor', name: 'X', mobile: null, source: 'link', ...over }
}
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()

test('the My link counts: sign-ups (tutors / parents) and tutors who paid, 7 and 30 days', () => {
  const accounts = [
    acct({ at: { signed_up: daysAgo(1), paid: daysAgo(0) } }),
    acct({ at: { signed_up: daysAgo(10) } }),
    acct({ role: 'parent', at: { signed_up: daysAgo(3) } }),
    acct({ at: { signed_up: daysAgo(40), paid: daysAgo(20) } }),
    acct({ staffId: 'other', at: { signed_up: daysAgo(1), paid: daysAgo(1) } }),
  ]
  const c = myLinkCounts(accounts, 'aqsa', NOW)
  assert.deepEqual(c.last7, { tutors: 1, parents: 1, tutorsPaid: 1 })
  assert.deepEqual(c.last30, { tutors: 2, parents: 1, tutorsPaid: 2 })
  const more = [...accounts, acct({ source: 'code', at: { signed_up: daysAgo(2) } }), acct({ source: 'claim', at: { signed_up: daysAgo(2) } })]
  const r = sourceRow('aqsa', 'Aqsa', more, NOW)
  assert.deepEqual([r.link, r.code, r.claim, r.total, r.paid7, r.paid30, r.paidAll], [4, 1, 1, 6, 1, 2, 2])
  assert.match(read('app/admin/page.tsx'), /<MyLinkCard staffId=\{actor\.id\} \/>/)
  assert.match(read('lib/staffSignups.ts'), /p\.role === 'admin' \|\| p\.is_test_name \|\| p\.hidden_from_public \|\| p\.is_seed \|\| p\.is_team_account/)
})

test('no phone number or email reaches a log line', () => {
  const files = [
    'app/api/ref/route.ts',
    'app/join/route.ts',
    'components/StaffRefCapture.tsx',
    'lib/staffSignups.ts',
    'components/admin/MyLinkCard.tsx',
    'app/admin/team-activity/SourceTable.tsx',
  ]
  for (const f of files) {
    for (const line of read(f).split('\n')) {
      if (!/console\.(log|info|warn|error)\(/.test(line)) continue
      assert.doesNotMatch(line, /phone|mobile|msisdn|email|identifier|\bcode\b|cookie/i, `${f}: ${line.trim()}`)
    }
  }
})
