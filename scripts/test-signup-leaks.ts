// npm run test:signupleaks — the sign-up leaks PR (owner, 15 Oct 2026).
//
// Header "Join free", the Apply pop-up and its return-to, return-to safety,
// the non-Owner Team view, the blocked-attempt alert, staff two-factor, the
// documents_approved WhatsApp, the posting board maths, the funnel, and
// Notify-me by email. Pure rules are called; route and component wiring that
// needs a live session or a browser is checked by reading the source.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { headerAuthButtons } from '../lib/headerAuth'
import { safeReturnTo, applyReturnPath, authHref, newTutorDestination, APPLY_READY_PARAM } from '../lib/returnTo'
import { nextForRole } from '../lib/authRoutes'
import {
  alwaysNeedsTwoFactor,
  roleSatisfies,
  SCREEN_ACCESS,
  OWNER_PROTECTED,
  OWNER_ONLY_OWNERSHIP,
  PARTNER_PROTECTED,
  type AdminRole,
} from '../lib/adminAccessCore'
import { isOwnerProtectionRefusal, blockedAttemptBody } from '../lib/ownerAlertCore'
import {
  documentsApprovedKey,
  fillDocumentsApproved,
  allDocumentsApproved,
  waMeHref,
  DOCUMENTS_APPROVED_FALLBACK,
  DOCUMENTS_APPROVED_KEY,
  DOCUMENTS_APPROVED_PAID_KEY,
} from '../lib/documentsApprovedCore'
import { change, changeLabel, countPosts, postingWindows, pktDayStartMs, sortPostingRows, totalRow, emptyPostingCounts } from '../lib/tuitionPostingCore'
import { countsAsVisit, funnelSteps, funnelWindows, visitKindsFor } from '../lib/signupFunnelCore'

const read = (p: string) => readFileSync(p, 'utf8')

test('header: Join free and Login for a signed-out visitor only, never where they already are', () => {
  assert.deepEqual(headerAuthButtons('/'), { join: true, login: true })
  assert.deepEqual(headerAuthButtons('/tuitions/lahore/x'), { join: true, login: true })
  assert.deepEqual(headerAuthButtons('/register'), { join: false, login: true })
  assert.deepEqual(headerAuthButtons('/login'), { join: true, login: false })
  const cta = read('components/AuthCTA.tsx')
  assert.ok(cta.includes('href="/register"') && cta.includes('Join free') && cta.includes('href="/login"'))
  // Join free is the primary (red) button, Login the secondary (outline).
  assert.ok(cta.indexOf('bg-tm-red') < cta.indexOf('border-tm-navy'))
  // The Navbar renders AuthCTA only in the no-session branch.
  const nav = read('components/Navbar.tsx')
  const noSession = nav.slice(nav.indexOf('if (!session) {'), nav.indexOf("const role = session.profile?.role"))
  assert.ok(noSession.includes('<AuthCTA />'))
  assert.equal((nav.match(/<AuthCTA/g) ?? []).length, 1)
})

test('return-to is a same-site path only', () => {
  for (const ok of ['/', '/tuitions/lahore/abc', '/tuitions/lahore/abc?apply=1', '/tutor/onboarding?next=%2Fx']) {
    assert.equal(safeReturnTo(ok), ok, ok)
  }
  for (const bad of [
    'https://evil.com', 'http://evil.com/x', '//evil.com', '/\\evil.com', '\\\\evil.com', 'javascript:alert(1)',
    '/%2F%2Fevil.com', '/%5Cevil.com', '/\t/evil.com', '/\n/evil.com', 'evil.com', '', ' ', '/' + 'a'.repeat(600),
  ]) {
    assert.equal(safeReturnTo(bad), null, JSON.stringify(bad))
  }
  assert.equal(nextForRole('//evil.com', 'tutor'), null)
  assert.equal(nextForRole('/\\evil.com', 'tutor'), null)
  assert.equal(nextForRole('https://evil.com', 'parent'), null)
  assert.equal(nextForRole('/tuitions/lahore/abc?apply=1', 'tutor'), '/tuitions/lahore/abc?apply=1')
})

test('Apply pop-up: Join free first, Sign in second, both carrying the tuition with Apply ready', () => {
  assert.equal(applyReturnPath('/tuitions/lahore/abc'), `/tuitions/lahore/abc?${APPLY_READY_PARAM}=1`)
  assert.equal(applyReturnPath('/tuitions/lahore/abc?x=2'), '/tuitions/lahore/abc?x=2&apply=1')
  assert.equal(applyReturnPath('https://evil.com'), '/browse/tuitions?apply=1')
  assert.equal(authHref('/register', '/tuitions/lahore/abc?apply=1', 'tutor'), '/register?next=%2Ftuitions%2Flahore%2Fabc%3Fapply%3D1&role=tutor')
  assert.equal(authHref('/login', '//evil.com', 'tutor'), '/login?role=tutor')
  const modal = read('components/AuthGateModal.tsx')
  assert.ok(modal.includes("title: 'Apply for this tuition'"))
  assert.ok(modal.includes('Join free — new tutor') && modal.includes('Already have an account? Sign in'))
  assert.ok(modal.indexOf('Join free — new tutor') < modal.indexOf('Already have an account? Sign in'))
  assert.ok(!modal.includes("title: 'Sign in to apply'"))
  assert.ok(modal.includes("go('/register')") && modal.includes("go('/login')"))
  // The card sends the guest back to the tuition's own page, not the list.
  assert.ok(read('components/JobCard.tsx').includes('next={detailHref}'))
  // The tuition page makes Apply ready on return (focus, one line) and never auto-sends.
  const panel = read('app/(site)/tuitions/[city]/[slug]/ApplyPanel.tsx')
  assert.ok(panel.includes('APPLY_READY_PARAM') && panel.includes('.focus(') && panel.includes('Tap Apply to send your application'))
  assert.ok(!/useEffect\([\s\S]{0,400}postGated/.test(panel), 'returning never applies by itself')
})

test('return-to survives register → verify mobile → onboarding, and sign-in', () => {
  // A brand-new tutor goes through onboarding, then back to the tuition.
  assert.equal(newTutorDestination('/tuitions/lahore/abc?apply=1'), '/tutor/onboarding?next=%2Ftuitions%2Flahore%2Fabc%3Fapply%3D1')
  assert.equal(newTutorDestination(null), '/tutor/onboarding')
  assert.equal(newTutorDestination('https://evil.com'), '/tutor/onboarding')
  assert.equal(newTutorDestination('/tutor/onboarding?next=%2Fx'), '/tutor/onboarding?next=%2Fx')
  // Mobile path: /register → /verify-phone?next → verify API → newTutorDestination.
  const form = read('app/(site)/register/RegisterForm.tsx')
  assert.ok(form.includes('`/verify-phone?next=${encodeURIComponent(safeNext)}`'))
  assert.ok(form.includes("data?.next === '/tutor/onboarding' && safeNext") && form.includes('newTutorDestination(safeNext)'))
  assert.ok(form.includes("authHref('/login', next ?? null"), 'the Sign in link on /register keeps the return-to')
  assert.ok(read('app/(site)/verify-phone/PendingVerifyForm.tsx').includes('next'))
  const verify = read('app/api/auth/register/verify/route.ts')
  assert.ok(verify.includes('newTutorDestination(allowed)'))
  // Onboarding reads next, validates it, and uses it at its end.
  const onboarding = read('app/(site)/tutor/onboarding/page.tsx')
  assert.ok(onboarding.includes("nextForRole(next, 'tutor')") && onboarding.includes('returnTo={returnTo}'))
  assert.ok(onboarding.includes("redirect(returnTo ?? '/tutor/dashboard')"))
  const flow = read('components/tutor/NewOnboardingFlow.tsx')
  assert.ok(flow.includes("leave(returnTo ?? '/tutor/dashboard')") && flow.includes('Back to the tuition'))
  // Sign-in already honours next (validated).
  assert.ok(read('app/(site)/login/LoginForm.tsx').includes('nextForRole(next, role) ?? homeForRole(role)'))
})

test('the Team page hides owner notes and role descriptions from everyone but the Owner', () => {
  const team = read('app/admin/team/TeamClient.tsx')
  assert.ok(team.includes("const ownerView = viewerRole === 'owner'"))
  assert.ok(/\{ownerView && \(\s*<header/.test(team), 'the "One account holds…" line is Owner-only')
  assert.ok(team.includes('{ownerView && <span className="block text-[11px] text-gray-500">{r.blurb}</span>}'))
  assert.ok(team.includes('{ownerView ? `${r.label} — ${r.blurb}` : r.label}'))
  assert.ok(team.includes("!ownerView && (s.adminRole === 'owner' || s.adminRole === 'partner') ? null"))
  assert.ok(team.includes("s.isMe && s.adminRole === 'owner' && viewerRole === 'owner'"), '"(account owner)" only on the Owner\'s own view')
})

test('a blocked attempt on the Owner account alerts the Owner (bell + email + Audit)', () => {
  assert.equal(isOwnerProtectionRefusal(OWNER_PROTECTED, OWNER_PROTECTED, OWNER_ONLY_OWNERSHIP), true)
  assert.equal(isOwnerProtectionRefusal(OWNER_ONLY_OWNERSHIP, OWNER_PROTECTED, OWNER_ONLY_OWNERSHIP), true)
  assert.equal(isOwnerProtectionRefusal(PARTNER_PROTECTED, OWNER_PROTECTED, OWNER_ONLY_OWNERSHIP), false)
  assert.equal(isOwnerProtectionRefusal(null, OWNER_PROTECTED, OWNER_ONLY_OWNERSHIP), false)
  const body = blockedAttemptBody('Aqsa Mughal (Admin)', 'pause the Owner account', new Date('2026-10-15T09:00:00Z'))
  assert.ok(body.includes('Aqsa Mughal') && body.includes('pause the Owner account') && body.includes('2:00 pm (Pakistan time)'))
  const alerts = read('lib/ownerAlerts.ts')
  assert.ok(alerts.includes("action: 'owner.protection_blocked'") && alerts.includes("kind: 'owner_alert'") && alerts.includes('deliverEmail('))
  const guard = read('lib/ownerGuard.ts')
  assert.ok(guard.indexOf('alertOwnerBlocked(') < guard.indexOf('status: 403'))
  for (const f of ['app/api/admin/team/route.ts', 'app/api/admin/mfa/reset/route.ts', 'lib/staff.ts']) {
    assert.ok(read(f).includes('alertOwnerBlocked('), f)
  }
})

test('every staff role needs two-factor; a session without it is refused', () => {
  for (const r of ['owner', 'admin', 'operations', 'tuitions_staff', 'partner'] as AdminRole[]) assert.equal(alwaysNeedsTwoFactor(r), true, r)
  assert.ok(read('lib/adminAuth.ts').includes('alwaysNeedsTwoFactor(actor.adminRole) && !opts.self'))
  assert.ok(read('app/admin/layout.tsx').includes('<MfaGate mode="setup"'))
})

test('documents_approved picks the right version and fills it', () => {
  assert.equal(documentsApprovedKey(false), DOCUMENTS_APPROVED_KEY)
  assert.equal(documentsApprovedKey(true), DOCUMENTS_APPROVED_PAID_KEY)
  const unpaid = fillDocumentsApproved(DOCUMENTS_APPROVED_FALLBACK[DOCUMENTS_APPROVED_KEY], { name: 'ayesha khan', payLink: 'https://www.tutormint.org/pay/choose?plan=verified', profileLink: null })
  assert.ok(unpaid.startsWith('Assalam o Alaikum ayesha,') && unpaid.includes('/pay/choose?plan=verified') && unpaid.includes('0321 5872222'))
  const paid = fillDocumentsApproved(DOCUMENTS_APPROVED_FALLBACK[DOCUMENTS_APPROVED_PAID_KEY], { name: 'Bilal', payLink: 'x', profileLink: 'https://www.tutormint.org/tutor/bilal' })
  assert.ok(paid.includes('profile is now live') && paid.includes('/tutor/bilal'))
  for (const t of [unpaid, paid]) assert.ok(!/rs\.?\s*\d|pkr|\d{3}\s*(rupees|rs)/i.test(t), 'no fee amount')
  assert.equal(allDocumentsApproved({ cnic: 'approved', profilePic: 'approved', selfie: 'approved' }), true)
  assert.equal(allDocumentsApproved({ cnic: 'approved', profilePic: 'pending', selfie: 'approved' }), false)
  assert.equal(waMeHref('923001234567', 'hi there'), 'https://wa.me/923001234567?text=hi%20there')
  assert.equal(waMeHref('03001234567', 'x'), null)
  // The migration seeds both rows with exactly the owner's wording.
  const sql = read('supabase/migrations/173_signup_funnel_templates_owner_name.sql')
  assert.ok(sql.includes(DOCUMENTS_APPROVED_FALLBACK[DOCUMENTS_APPROVED_KEY]) && sql.includes(DOCUMENTS_APPROVED_FALLBACK[DOCUMENTS_APPROVED_PAID_KEY]))
  // The button logs a follow-up and shows only when all three are approved.
  assert.ok(read('components/admin/DocumentsApprovedWhatsApp.tsx').includes("source: 'documents'"))
  assert.ok(read('components/admin/TutorDocumentReview.tsx').includes('allDocumentsApproved(live) && <DocumentsApprovedWhatsApp'))
})

test('approval and rejection notices: email + in-app on every decision, never an SMS', () => {
  const tutor = read('lib/tutorDocuments.ts')
  const parent = read('lib/parentDocuments.ts')
  assert.ok((tutor.match(/id: 'document_approved'/g) ?? []).length >= 2)
  assert.ok((parent.match(/id: 'document_approved'/g) ?? []).length >= 2)
  assert.ok((tutor.match(/id: 'verification_rejected'/g) ?? []).length >= 2)
  assert.ok((parent.match(/id: 'verification_rejected'/g) ?? []).length >= 2)
  assert.ok(!/sendSms/.test(tutor + parent))
  assert.ok(read('lib/notify/templates.ts').includes("case 'document_approved':"))
})

test('Today vs Yesterday compares to the same time of day (Pakistan time), and 0 reads —', () => {
  // 15 Oct 2026, 11:00 Pakistan time = 06:00 UTC.
  const now = Date.parse('2026-10-15T06:00:00Z')
  assert.equal(new Date(pktDayStartMs(now)).toISOString(), '2026-10-14T19:00:00.000Z')
  const w = postingWindows(now)
  const at = (iso: string) => Date.parse(iso)
  const posts = [
    at('2026-10-14T20:00:00Z'), // today 01:00 PKT
    at('2026-10-15T05:00:00Z'), // today 10:00 PKT
    at('2026-10-13T21:00:00Z'), // yesterday 02:00 PKT — before the same time
    at('2026-10-14T08:00:00Z'), // yesterday 13:00 PKT — after the same time
    at('2026-10-10T08:00:00Z'), // inside the last 7 days
    at('2026-10-05T08:00:00Z'), // the previous 7 days
  ]
  const c = countPosts(posts, w)
  assert.deepEqual(c, { today: 2, yesterday: 2, yesterdayToTime: 1, last7: 5, prev7: 1 })
  assert.equal(changeLabel(change(c.today, c.yesterdayToTime)), '▲ 100%')
  assert.equal(changeLabel(change(1, 4)), '▼ 75%')
  assert.equal(changeLabel(change(3, 3)), '0%')
  assert.equal(change(5, 0), null)
  assert.equal(changeLabel(change(5, 0)), '—')
  assert.equal(changeLabel(change(0, 0)), '—')
  const rows = sortPostingRows([
    { id: 'a', name: 'Zubia', counts: { ...emptyPostingCounts(), today: 1 }, repeats: 0 },
    { id: 'b', name: 'Aseer', counts: { ...emptyPostingCounts(), today: 4 }, repeats: 2 },
  ])
  assert.deepEqual(rows.map((r) => r.id), ['b', 'a'])
  assert.deepEqual(totalRow(rows).counts.today, 5)
  assert.equal(totalRow(rows).repeats, 2)
})

test('Tuitions staff open the posting board and the Tuitions group, never Staff activity', () => {
  for (const k of ['jobs', 'jobsPost', 'pausedTuitions', 'duplicates', 'applicantForwards', 'tuitionPosting'] as const) {
    assert.equal(roleSatisfies('tuitions_staff', SCREEN_ACCESS[k]), true, k)
  }
  assert.equal(roleSatisfies('tuitions_staff', SCREEN_ACCESS.staffActivity), false)
  // Admin got Staff activity back, view only (owner, 15 Oct 2026, later).
  assert.equal(roleSatisfies('admin', SCREEN_ACCESS.staffActivity), true)
  assert.equal(roleSatisfies('operations', SCREEN_ACCESS.staffActivity), false)
  assert.equal(roleSatisfies('owner', SCREEN_ACCESS.staffActivity), true)
  assert.equal(roleSatisfies('partner', SCREEN_ACCESS.staffActivity), true)
  for (const r of ['admin', 'operations', 'tuitions_staff', 'partner', 'owner'] as AdminRole[]) assert.equal(roleSatisfies(r, SCREEN_ACCESS.tuitionPosting), true, r)
  assert.equal(roleSatisfies('tuitions_staff', SCREEN_ACCESS.finance), false)
  assert.equal(roleSatisfies('tuitions_staff', SCREEN_ACCESS.tutors), false)
  const nav = read('lib/adminNav.ts')
  const group = nav.slice(nav.indexOf("title: 'Tuitions'"), nav.indexOf("title: 'Marketplace'"))
  for (const href of ['/admin/jobs', '/admin/jobs/new', '/admin/jobs/paused', '/admin/jobs/duplicates', '/admin/jobs/applicants', '/admin/jobs/posting-activity']) {
    assert.ok(group.includes(`href: '${href}'`), href)
  }
  assert.ok(read('app/admin/jobs/posting-activity/page.tsx').includes('requireAdminRole(...SCREEN_ACCESS.tuitionPosting)'))
})

test('daily sign-up funnel: real browsers, counts only, drop at each step', () => {
  assert.equal(countsAsVisit('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'), true)
  assert.equal(countsAsVisit('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'), false)
  assert.equal(countsAsVisit('TutorMint-link-check/1.0'), false)
  assert.equal(countsAsVisit(''), false)
  assert.deepEqual(visitKindsFor('/register'), ['public_page', 'register_page'])
  assert.deepEqual(visitKindsFor('/tuitions/lahore/x'), ['public_page'])
  assert.deepEqual(visitKindsFor('/admin'), [])
  assert.deepEqual(visitKindsFor('//evil'), [])
  const steps = funnelSteps([
    { key: 'a', label: 'A', count: 200 },
    { key: 'b', label: 'B', count: 50 },
    { key: 'c', label: 'C', count: 0 },
    { key: 'd', label: 'D', count: 0 },
  ])
  assert.deepEqual(steps.map((s) => [s.lost, s.lostPct]), [[null, null], [150, 75], [50, 100], [0, null]])
  const w = funnelWindows(Date.parse('2026-10-15T06:00:00Z'))
  assert.deepEqual(w.map((x) => x.key), ['today', 'yesterday', 'last7'])
  assert.deepEqual(w[0].days, ['2026-10-15'])
  assert.deepEqual(w[1].days, ['2026-10-14'])
  assert.equal(w[2].days.length, 7)
  assert.equal(w[2].days[6], '2026-10-09')
  // Counts only — the table has no visitor id or IP column.
  const sql = read('supabase/migrations/173_signup_funnel_templates_owner_name.sql')
  const table = sql.slice(sql.indexOf('create table if not exists public.site_visit_counts'), sql.indexOf('alter table public.site_visit_counts'))
  assert.ok(!/\bip\b|visitor|user_id|anon/i.test(table))
  assert.equal(roleSatisfies('admin', SCREEN_ACCESS.signupFunnel), false)
  assert.equal(roleSatisfies('partner', SCREEN_ACCESS.signupFunnel), true)
  assert.ok(read('components/SiteChrome.tsx').includes('{!session && <VisitBeacon />}'))
})

test('Notify me asks for an email only', () => {
  const form = read('components/search/NotifyMe.tsx')
  assert.ok(form.includes('type="email"') && form.includes('Your email') && !form.includes('0300 1234567'))
  const lib = read('lib/tutorAlerts.ts')
  assert.ok(lib.includes("if (!v || !v.includes('@')) return null"))
  assert.ok(lib.includes('We can only send this by email. Enter your email address.'))
  assert.ok(!lib.includes('sendSms'))
})
