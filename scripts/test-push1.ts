// npm run test:push1 — "Fast admin, Number first, cost and email clean-up"
// push 1 (owner, 31 Oct 2026): one email per auth event, double-submit guards,
// invalid addresses skipped, Number first, retired and merged admin pages,
// owner-only payment settings, social links, Content queue ordering and junk,
// the single-Owner lock, and no personal data in log lines.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { emailChangeDecision, pendingChangeMatches, RESEND_GUARD_MS } from '../lib/emailChangeCore'
import { onceAtATime, resendAllowed, RESEND_COOLDOWN_MS } from '../lib/submitGuard'
import { recipientProblem } from '../lib/notify/recipient'
import {
  formMayOpen,
  isParentAccount,
  lastTen,
  linkedParent,
  maskNumber,
  numberFirstOutcome,
  NUMBER_FIRST_DNU,
  NUMBER_FIRST_HOLD,
  type ExistingTuition,
} from '../lib/numberFirstCore'
import { RETIRED_ADMIN_APIS, RETIRED_ADMIN_PAGES, RETIRED_API_MESSAGE, tutorRecordRedirect } from '../lib/retiredAdminCore'
import { PAYMENT_SETTINGS_SECTIONS, RETIRED_PAYMENT_SETTINGS, paymentSettingsHref } from '../lib/paymentSettingsCore'
import { memberEditHref } from '../lib/memberEditCore'
import {
  fillSocialLinks,
  socialLinksAllowed,
  socialLinksBlock,
  socialPagesFrom,
  SOCIAL_LINKS_DEFAULT,
  withRef,
} from '../lib/socialLinksCore'
import { isJunkQuery, tutorTopicsFirst, buildSearchTopics } from '../lib/contentQueue/searchTopics'
import { SCREEN_ACCESS, roleMayWrite, roleSatisfies, staffChangeProblem, OWNER_ROLE_FIXED } from '../lib/adminAccessCore'

const read = (p: string) => readFileSync(p, 'utf8')
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// --------------------------------------------------------------- emails ---

test('one email per email change: ours, never Supabase’s pair', () => {
  const route = code('app/api/account/email/route.ts')
  assert.doesNotMatch(route, /auth\.updateUser\(/, 'the route no longer asks Supabase to send (it mailed two addresses)')
  assert.match(route, /requestEmailChange\(/)
  const lib = code('lib/emailConfirm.ts')
  // One deliverEmail to the NEW address only.
  const fn = lib.slice(lib.indexOf('export async function requestEmailChange'), lib.indexOf('async function completePendingChange'))
  assert.equal((fn.match(/deliverEmail\(/g) ?? []).length, 1)
  assert.match(fn, /\{ email, name:/)
  // The sign-in address changes only when the link is clicked.
  assert.match(lib, /email_confirm: true/)
  assert.doesNotMatch(fn, /email_confirm/)
})

test('a repeat of the same address within a minute sends nothing', () => {
  const now = Date.parse('2026-10-31T10:00:00Z')
  const at = new Date(now - 10_000).toISOString()
  assert.deepEqual(emailChangeDecision({ email: 'a@b.com', currentAuthEmail: '923001234567@users.tutormint.org', pendingEmail: 'A@B.com', pendingAt: at, now }), { kind: 'already_sent' })
  const old = new Date(now - RESEND_GUARD_MS - 1).toISOString()
  assert.deepEqual(emailChangeDecision({ email: 'a@b.com', currentAuthEmail: null, pendingEmail: 'a@b.com', pendingAt: old, now }), { kind: 'send' })
  assert.deepEqual(emailChangeDecision({ email: 'c@d.com', currentAuthEmail: null, pendingEmail: 'a@b.com', pendingAt: at, now }), { kind: 'send' })
  assert.deepEqual(emailChangeDecision({ email: 'x@y.com', currentAuthEmail: 'x@y.com', pendingEmail: null, pendingAt: null, now }), { kind: 'same_as_current' })
  // A placeholder address is never "already your email".
  assert.deepEqual(emailChangeDecision({ email: '923001234567@users.tutormint.org', currentAuthEmail: '923001234567@users.tutormint.org', pendingEmail: null, pendingAt: null, now }), { kind: 'send' })
  assert.equal(pendingChangeMatches('A@b.com', 'a@B.com'), true)
  assert.equal(pendingChangeMatches(null, 'a@b.com'), false)
  assert.equal(pendingChangeMatches('a@b.com', ''), false)
})

test('double-submit guards on every button that sends', async () => {
  assert.equal(resendAllowed({ busy: true, lastSentAt: null, now: 0 }), false)
  assert.equal(resendAllowed({ busy: false, lastSentAt: null, now: 0 }), true)
  assert.equal(resendAllowed({ busy: false, lastSentAt: 0, now: RESEND_COOLDOWN_MS - 1 }), false)
  assert.equal(resendAllowed({ busy: false, lastSentAt: 0, now: RESEND_COOLDOWN_MS }), true)
  // onceAtATime: two calls in the same tick run the work once.
  let n = 0
  const box = { current: false }
  const fn = onceAtATime(box, async () => {
    n++
    await new Promise((r) => setTimeout(r, 5))
  })
  await Promise.all([fn(), fn()])
  assert.equal(n, 1)
  // The screens use a ref guard (it catches a click in the same frame).
  for (const [file, needle] of [
    ['app/(site)/register/RegisterForm.tsx', 'if (inFlight.current) return'],
    ['app/(site)/forgot-password/ForgotPasswordForm.tsx', 'if (inFlight.current) return'],
    ['app/(site)/login/LoginForm.tsx', 'resendAllowed('],
    ['components/account/EmailCard.tsx', 'if (sending.current) return'],
    ['components/account/EmailConfirmReminder.tsx', 'resendAllowed('],
    ['components/tutor/NewOnboardingFlow.tsx', 'if (emailInFlight.current) return'],
  ] as const) {
    assert.ok(read(file).includes(needle), `${file} guards against a double submit`)
  }
  assert.match(read('components/tutor/NewOnboardingFlow.tsx'), /nextDisabled: sendingEmail/)
})

test('invalid addresses are skipped, never sent', () => {
  for (const bad of ['', ' a@b.com', 'a b@c.com', 'no-at', 'a@@b.com', 'a@b', 'a@b.c0m', 'erased-1@users.tutormint.org']) {
    assert.notEqual(recipientProblem(bad), null, bad)
  }
  assert.equal(recipientProblem('name@example.com'), null)
  const send = code('lib/email/send.ts')
  assert.ok((send.match(/recipientProblem\(/g) ?? []).length >= 2, 'checked in sendOne and sendBulk')
})

// --------------------------------------------------------- number first ---

const T: ExistingTuition = { id: 't1', ref: 'TM-2001', title: 'Home Tutor Required', city: 'Lahore', status: 'open', postedAt: '2026-10-30T00:00:00Z', poster: 'Aqsa', href: '/admin/jobs/t1' }
const msisdn = '923001234567'

test('Number first: each outcome', () => {
  const dnu = numberFirstOutcome({ msisdn, doNotUse: true, onHold: true, tuitions: [T], parent: { id: 'p', name: 'Ali' } })
  assert.equal(dnu.kind, 'do_not_use')
  assert.equal(dnu.kind === 'do_not_use' && dnu.message, NUMBER_FIRST_DNU)
  assert.equal(NUMBER_FIRST_DNU, "This number has asked not to be contacted. Please don't post it.")
  assert.equal(formMayOpen(dnu, true), false, 'the form stays closed')

  const hold = numberFirstOutcome({ msisdn, doNotUse: false, onHold: true, tuitions: [T], parent: null })
  assert.equal(hold.kind, 'on_hold')
  assert.equal(NUMBER_FIRST_HOLD, 'This number has a complaint on file. Please check with the owner first.')
  assert.equal(formMayOpen(hold, true), false)

  const existing = numberFirstOutcome({ msisdn, doNotUse: false, onHold: false, tuitions: [T], parent: { id: 'p', name: 'Ali' } })
  assert.equal(existing.kind, 'existing')
  assert.equal(formMayOpen(existing, false), false, 'waits for Continue anyway')
  assert.equal(formMayOpen(existing, true), true)
  assert.deepEqual(linkedParent(existing), { id: 'p', name: 'Ali' })

  const parent = numberFirstOutcome({ msisdn, doNotUse: false, onHold: false, tuitions: [], parent: { id: 'p', name: 'Ali' } })
  assert.equal(parent.kind, 'parent_account')
  assert.equal(formMayOpen(parent, false), true)
  assert.deepEqual(linkedParent(parent), { id: 'p', name: 'Ali' })

  const clear = numberFirstOutcome({ msisdn, doNotUse: false, onHold: false, tuitions: [], parent: null })
  assert.equal(clear.kind, 'clear')
  assert.equal(formMayOpen(clear, false), true)
  assert.equal(linkedParent(clear), null)

  // Always masked; never the whole number.
  for (const o of [dnu, hold, existing, parent, clear]) {
    assert.doesNotMatch(JSON.stringify(o), /3001234567/)
    assert.equal(o.masked, maskNumber(msisdn))
  }
  assert.equal(lastTen('+92 300-1234567'), '3001234567')
  assert.equal(isParentAccount({ role: 'parent' }), true)
  assert.equal(isParentAccount({ role: 'tutor' }), false)
  assert.equal(isParentAccount({ role: 'parent', is_team_account: true }), false)
  assert.equal(isParentAccount({ role: 'parent', merged_into: 'x' }), false)
})

test('Number first: wired into both staff forms; save re-checks; blocked attempts logged without the number', () => {
  assert.match(read('app/admin/jobs/new/AdminJobForm.tsx'), /numberFirst=\{\{ where: 'post' \}\}/)
  assert.match(read('app/admin/jobs/[id]/edit/AdminJobEditForm.tsx'), /numberFirst=\{\{ where: 'edit', jobId \}\}/)
  const form = read('components/forms/PostTuitionForm.tsx')
  assert.match(form, /if \(numberFirst && !numberPassed\) \{/)
  const route = code('app/api/admin/jobs/number-check/route.ts')
  assert.match(route, /checkAdminRole\(\.\.\.SCREEN_ACCESS\.jobsPost\)/)
  assert.match(route, /auditNumberBlocked\(/)
  const nf = code('lib/numberFirst.ts')
  const audit = nf.slice(nf.indexOf('export async function auditNumberBlocked'), nf.indexOf('/** The parent account holding'))
  assert.match(audit, /numberHash\(msisdn\)\.slice\(0, 12\)/)
  assert.doesNotMatch(audit, /detail: \{[^}]*msisdn/)
  // The save paths re-check the lists as the backup.
  const jobs = code('lib/jobs.ts')
  assert.ok((jobs.match(/doNotUseRefusal\(/g) ?? []).length >= 3, 'createJob, createTeamJob and updateTeamJob')
  assert.ok((jobs.match(/linkTuitionToParentByNumber\(/g) ?? []).length === 2, 'create and edit link to the parent account')
  // The parent's own form gets the Do-not-use and On-hold checks (doNotUseRefusal covers both).
  assert.match(code('lib/contactWithdraw.ts'), /postingRefusal\(numbers, dnu, holds\)/)
})

// ------------------------------------------------ retired and merged pages ---

const pageFor = (p: string) => path.join('app', ...p.split('/').filter(Boolean), 'page.tsx')

test('every retired or merged admin page redirects to its new home', () => {
  for (const [from, to] of Object.entries(RETIRED_ADMIN_PAGES)) {
    const file = pageFor(from)
    assert.ok(existsSync(file), file)
    const s = code(file)
    assert.match(s, /permanentRedirect\(/, `${from} redirects`)
    assert.doesNotMatch(s, /requireAdminRole|createAdminClient/, `${from} renders nothing of its own`)
    assert.ok(to.startsWith('/admin'), to)
  }
  for (const [from, section] of Object.entries(RETIRED_PAYMENT_SETTINGS)) {
    assert.equal(RETIRED_ADMIN_PAGES[from], paymentSettingsHref(section))
  }
  const id = '6ffe2384-1111-4222-8333-444455556666'
  assert.equal(tutorRecordRedirect(`/admin/tutors/${id}`), memberEditHref(id))
  assert.equal(tutorRecordRedirect('/admin/tutors/videos'), null)
  assert.match(code('app/admin/tutors/[id]/page.tsx'), /permanentRedirect\(memberEditHref\(id\)\)/)
  // No link anywhere still points at a retired page.
  const files: string[] = []
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(f)) files.push(p)
    }
  }
  for (const d of ['app', 'components', 'lib']) walk(d)
  const retired = Object.keys(RETIRED_ADMIN_PAGES).filter((p) => !p.startsWith('/admin/overview'))
  for (const f of files) {
    if (f.includes('retiredAdminCore') || f.includes('paymentSettingsCore')) continue
    if (Object.keys(RETIRED_ADMIN_PAGES).some((r) => path.normalize(f) === path.normalize(pageFor(r)))) continue
    const s = read(f)
    for (const r of retired) {
      const re = new RegExp(`['"\`]${r.replace(/[/-]/g, (m) => `\\${m}`)}(?:['"\`#?])`)
      assert.doesNotMatch(s, re, `${f} still links to ${r}`)
    }
    assert.doesNotMatch(s, /['"`]\/admin\/tutors\/\$\{/, `${f} links to the old tutor record page`)
  }
})

test('retired admin APIs answer 410 and change nothing', async () => {
  for (const r of RETIRED_ADMIN_APIS) {
    const file = path.join('app', ...r.split('/').filter(Boolean), 'route.ts')
    const s = code(file)
    assert.match(s, /return retiredApi\(\)/, file)
    assert.doesNotMatch(s, /createAdminClient|from\('/, `${file} reads and writes nothing`)
  }
  const { retiredApi } = await import('../lib/retiredApi')
  const res = retiredApi()
  assert.equal(res.status, 410)
  assert.equal(((await res.json()) as { error: string }).error, RETIRED_API_MESSAGE)
  // The sidebar no longer offers them.
  const nav = read('lib/adminNav.ts')
  for (const gone of ["'/admin/ads'", "'/admin/users/featured-whatsapp'", "'/admin/payments/settings/gateways'", "'/admin/settings/sms'", "'/admin/settings/email'", "'/admin/settings/email-usage'"]) {
    assert.ok(!nav.includes(`href: ${gone}`), gone)
  }
  assert.ok(nav.includes("href: '/admin/settings/messaging'"))
  // The one-off internal routes and the simulator are gone.
  for (const f of [
    'app/api/internal/blog-draft-test/route.ts',
    'app/api/internal/link-ayaz-bank-credit/route.ts',
    'app/api/internal/merge-duplicates/route.ts',
    'app/api/internal/suggest-cnic-numbers/route.ts',
    'app/api/internal/switched-tutor-email/route.ts',
    'app/api/internal/webhook-test/route.ts',
    'app/api/payments/simulate/route.ts',
    'app/(site)/pay/simulator/[ref]/page.tsx',
    'lib/payments/simulator.ts',
    'lib/payments/assanpay.ts',
  ]) {
    assert.equal(existsSync(f), false, f)
  }
  // The renamed cron is what vercel.json schedules; the old path was retired once it ran live (1 Nov 2026).
  const vercel = read('vercel.json')
  assert.ok(vercel.includes('"/api/cron/every-5-min"'))
  assert.ok(!vercel.includes('paypro-reconcile'))
  assert.equal(existsSync("app/api/cron/paypro-reconcile/route.ts"), false)
  assert.match(code('app/api/cron/every-5-min/route.ts'), /CRON_SECRET/)
})

test('the member page Edit tab holds the tutor tools, with no duplicate left', () => {
  const edit = read('app/admin/users/[id]/edit/page.tsx')
  for (const s of ['TutorFieldEditor', 'TutorFieldHistory', 'Retired addresses', 'SlugField']) assert.ok(edit.includes(s), s)
  assert.match(edit, /requireAdminRole\(\.\.\.SCREEN_ACCESS\.tutors\)/)
  // The Profile tab's "Change mobile" is not offered for a tutor (the Edit tab changes it).
  assert.match(read('app/admin/users/[id]/MemberActions.tsx'), /canVerifyMobile && !isTutor &&/)
  assert.equal(existsSync('app/admin/tutors/[id]/TutorFieldEditor.tsx'), false)
  assert.equal(existsSync('app/admin/users/[id]/edit/TutorFieldEditor.tsx'), true)
})

test('owner-only rules kept on the merged Payments → Settings', () => {
  for (const k of ['paymentsSwitches', 'paymentGateways', 'finance'] as const) {
    assert.deepEqual(SCREEN_ACCESS[k], [], k)
    assert.equal(roleSatisfies('owner', SCREEN_ACCESS[k]), true)
    assert.equal(roleSatisfies('partner', SCREEN_ACCESS[k]), true, 'the Partner views')
    assert.equal(roleMayWrite('partner', SCREEN_ACCESS[k]), false, 'the Partner may not change')
    for (const r of ['admin', 'operations', 'tuitions_staff', 'supervisor', 'backend_support'] as const) {
      assert.equal(roleSatisfies(r, SCREEN_ACCESS[k]), false, `${k}: ${r}`)
    }
  }
  assert.match(code('app/admin/payments/settings/page.tsx'), /requireAdminRole\(\.\.\.SCREEN_ACCESS\.paymentsSwitches\)/)
  for (const [route, key] of [
    ['app/api/admin/payments/switches/route.ts', 'paymentsSwitches'],
    ['app/api/admin/payments/gateways/route.ts', 'paymentGateways'],
    ['app/api/admin/payments/bank-details/route.ts', 'paymentGateways'],
    ['app/api/admin/finance/bank-reader/route.ts', 'finance'],
    ['app/api/admin/finance/fee-range/route.ts', 'finance'],
  ] as const) {
    const s = code(route)
    assert.ok(s.includes(`SCREEN_ACCESS.${key}`), `${route} checks ${key}`)
    assert.match(s, /requireFreshAuth\(/, `${route} asks for the password again`)
  }
  assert.equal(PAYMENT_SETTINGS_SECTIONS.map((s) => s.id).join(','), 'fee-and-plans,bank-transfer,fee-match-and-reader,paypro')
})

// --------------------------------------------------------- social links ---

test('social links: paid only, links from settings, ref code, undo', () => {
  assert.equal(socialLinksAllowed({ role: 'tutor', feePaidAt: '2026-10-01' }), true)
  assert.equal(socialLinksAllowed({ role: 'tutor', feePaidAt: null }), false)
  assert.equal(socialLinksAllowed({ role: 'parent', feePaidAt: '2026-10-01' }), false)
  const pages = socialPagesFrom({ SOCIAL_FACEBOOK: 'https://www.facebook.com/tutormint', SOCIAL_INSTAGRAM: 'https://instagram.com/tutormint', SOCIAL_YOUTUBE: '', SOCIAL_X: 'not a url', SOCIAL_TIKTOK: 'https://www.tiktok.com/@tutormint.official' })
  assert.deepEqual(pages.map((p) => p.label), ['Facebook', 'Instagram', 'TikTok'], 'only the pages that are set')
  const block = socialLinksBlock(pages, 'AQSA')
  assert.equal(
    block,
    'Facebook: https://www.facebook.com/tutormint?ref=AQSA\nInstagram: https://instagram.com/tutormint\nTikTok: https://www.tiktok.com/@tutormint.official?ref=AQSA',
  )
  assert.equal(socialLinksBlock(pages, null).includes('ref='), false, 'no code, no ref')
  assert.equal(withRef('https://x.com/a?ref=Z', 'AQSA'), 'https://x.com/a?ref=Z', 'never twice')
  const msg = fillSocialLinks(SOCIAL_LINKS_DEFAULT, { firstName: 'Sara', socialLinks: block, supportWhatsapp: '0321 5872222' })
  assert.ok(msg.startsWith('Assalam o Alaikum Sara,\nThank you for joining TutorMint. Follow us for new tuitions and tips:\nFacebook:'))
  assert.ok(msg.endsWith('\n\nNeed help? WhatsApp 0321 5872222'))
  assert.doesNotMatch(msg, /\p{Extended_Pictographic}/u, 'no emoji')
  const route = code('app/api/admin/follow-ups/social-links/route.ts')
  assert.match(route, /socialLinksAllowed\(/)
  assert.match(route, /socialPagesFrom\(process\.env\)/)
  assert.match(route, /senderRefCode\(gate\.actor\.id\)/)
  assert.match(route, /undoTutorFollowUp\(b\.id, gate\.actor\)/)
  assert.match(route, /source: SOCIAL_LINKS_FOLLOW_UP_SOURCE/)
  assert.match(read('components/admin/SendSocialLinksButton.tsx'), /ms: 10_000/)
  assert.match(read('app/admin/users/[id]/page.tsx'), /socialLinksAllowed\(\{ role: profile\.role/)
  assert.match(read('supabase/migrations/216_number_first_social_links.sql'), /'social_links'/)
})

// -------------------------------------------------------- content queue ---

test('Content queue: tutor topics first, junk searches hidden', () => {
  for (const j of ['a', '5', 'a 1', 'mint tutor', 'Mint Tutors', 'mint', 'teacher teacher', 'tutor tutor jobs']) assert.equal(isJunkQuery(j), true, j)
  for (const ok of ['home tutor jobs in lahore', 'o level physics tutor', 'female teacher jobs karachi', 'tutor jobs']) assert.equal(isJunkQuery(ok), false, ok)
  const ordered = tutorTopicsFirst([
    { id: 1, side: 'parent' as const },
    { id: 2, side: 'tutor' as const },
    { id: 3, audience: 'tutors' },
    { id: 4, cluster: 'tutor-career' },
    { id: 5, audience: 'parents' },
  ])
  assert.deepEqual(ordered.map((o) => o.id), [2, 3, 4, 1, 5])
  const topics = buildSearchTopics(
    [
      { query: 'teacher teacher', clicks: 0, impressions: 50 },
      { query: 'tuition jobs in lahore', clicks: 2, impressions: 40 },
    ],
    { cities: ['Lahore'], areas: [], pages: [], posts: [] },
  )
  assert.deepEqual(topics.filter((t) => t.hidden).map((t) => t.queries[0].query), ['teacher teacher'])
  assert.equal(topics.filter((t) => !t.hidden).length, 1)
  assert.match(code('lib/contentQueue/build.ts'), /!t\.coveredBy && !t\.hidden/, 'a hidden topic is never queued')
  assert.match(read('components/admin/blog/QueueClient.tsx'), /Show hidden/)
})

// ------------------------------------------------------- single Owner ---

test('the single-Owner lock is intact', () => {
  assert.notEqual(staffChangeProblem('owner', 'admin', 'owner'), null, 'nobody hands out the Owner role')
  assert.equal(staffChangeProblem('owner', 'owner', 'admin'), OWNER_ROLE_FIXED)
  assert.equal(staffChangeProblem('owner', 'owner', null), OWNER_ROLE_FIXED)
  const m = read('supabase/migrations/215_single_owner_backend_support.sql')
  assert.match(m, /profiles_single_owner/)
  // Nothing in this push touches the lock.
  for (const f of ['216_number_first_social_links.sql', '217_social_links_follow_up.sql']) {
    assert.doesNotMatch(read(path.join('supabase/migrations', f)), /single_owner|admin_role/)
  }
})

// --------------------------------------------------------------- logs ---

test('no secrets or personal data in log lines', () => {
  const files: string[] = []
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(f)) files.push(p)
    }
  }
  for (const d of ['app', 'lib', 'components']) walk(d)
  files.push('proxy.ts', 'instrumentation.ts')
  const risky = /\b(phone|phone_number|msisdn|whatsapp|email|cnic|cnic_number|password|api_?key|secret|iban|account_number|token)\b/i
  const offenders: string[] = []
  let infoCalls = 0
  for (const f of files) {
    const lines = read(f).split('\n')
    lines.forEach((l, i) => {
      if (!/console\.(log|info|debug|warn|error)\(/.test(l)) return
      if (/console\.(log|info|debug)\(/.test(l)) infoCalls++
      // A variable that holds personal data or a secret passed straight in.
      const args = l.slice(l.indexOf('console.'))
      if (/\$\{[^}]*\b(phone|msisdn|email|cnic|password|apiKey|api_key|secret|token|iban)\b[^}]*\}/i.test(args) && !/mask|maskMsisdn|maskAddressForLog/.test(args)) {
        offenders.push(`${f}:${i + 1}`)
      }
      if (/,\s*(email|phone|msisdn|cnic|password|token)\s*\)/.test(args)) offenders.push(`${f}:${i + 1}`)
    })
  }
  assert.deepEqual(offenders, [], `log lines with personal data: ${offenders.join(', ')}`)
  void risky
  // Per-request info logs were cut (26 → 8 on 31 Oct 2026).
  assert.ok(infoCalls <= 8, `info/log calls: ${infoCalls}`)
})
