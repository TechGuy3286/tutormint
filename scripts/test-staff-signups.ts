// scripts/test-staff-signups.ts — Sign-ups by staff (owner, 15 Oct 2026).
//   npm run test:staffsignups
// Pure rules (lib/staffSignupsCore) plus source checks that the routes and pages
// use them. The live counts check is scripts/test-staff-signups-live.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  CREDIT_MS,
  CLAIM_WINDOW_MS,
  accountsAt,
  boardRow,
  claimRefusal,
  codeForSlug,
  creditRefusal,
  currentStep,
  fillJoinLink,
  isActiveParticipant,
  linkCreditRefusal,
  mayDecideClaim,
  mayViewStaff,
  normaliseStaffCode,
  onJoinLink,
  onStaffCode,
  periodRange,
  pickSlug,
  seesEveryone,
  slugBase,
  sortBoardRows,
  visitExpiry,
  visitValid,
  type AccountFacts,
  type CreditedAccount,
  type StaffContacts,
  type Visit,
} from '../lib/staffSignupsCore'
import { roleMayWrite, roleSatisfies, SCREEN_ACCESS, type AdminRole } from '../lib/adminAccessCore'
import { hiringPost } from '../lib/unmetSearchCore'
import { newTutorDestination, safeReturnTo } from '../lib/returnTo'

const read = (p: string) => readFileSync(p, 'utf8')
const NOW = Date.parse('2026-10-15T10:00:00Z') // 15:00 PKT
const DAY = 86_400_000

function visit(createdMs: number, staffId = 'aseer'): Visit {
  return { id: 'v1', staffId, createdAt: new Date(createdMs).toISOString(), expiresAt: visitExpiry(createdMs) }
}

function facts(over: Partial<AccountFacts> = {}): AccountFacts {
  return {
    id: 'm1',
    role: 'tutor',
    createdAt: new Date(NOW).toISOString(),
    mobiles: ['923001234567'],
    email: null,
    isTest: false,
    isDuplicate: false,
    alreadyCredited: false,
    ...over,
  }
}
const staff: StaffContacts = { mobiles: new Set(['923215872222']), emails: new Set(['aseer@tutormint.org']) }

test('slugs and codes come from the first name only and never collide', () => {
  assert.equal(slugBase('Aseer Ul Hassan'), 'aseer')
  assert.equal(slugBase('Nabeel'), 'nabeel')
  assert.equal(slugBase(''), 'staff')
  assert.equal(pickSlug('Aseer Ul Hassan', new Set(['aseer'])), 'aseer2')
  assert.equal(codeForSlug('aseer'), 'ASEER')
  assert.equal(normaliseStaffCode(' aseer '), 'ASEER')
  assert.equal(normaliseStaffCode('as-eer'), 'ASEER')
  assert.equal(normaliseStaffCode(''), null)
})

test('participants: Tuitions staff, Operations and Admin; paused or removed staff earn no new credits', () => {
  for (const r of ['tuitions_staff', 'operations', 'admin']) assert.equal(isActiveParticipant({ adminRole: r }), true, r)
  for (const r of ['owner', 'partner', null]) assert.equal(isActiveParticipant({ adminRole: r }), false, String(r))
  assert.equal(isActiveParticipant({ adminRole: 'operations', suspended: true }), false)
  assert.equal(isActiveParticipant({ role: 'tutor', adminRole: 'operations' }), false)
})

test('a join link records a credit; a valid earlier credit wins (first link wins)', () => {
  assert.equal(onJoinLink(null, NOW), 'record')
  assert.equal(onJoinLink(visit(NOW - 5 * DAY), NOW), 'keep')
})

test('the credit lasts 30 days', () => {
  const v = visit(NOW)
  assert.equal(Date.parse(v.expiresAt) - NOW, CREDIT_MS)
  assert.equal(visitValid(v, NOW + 29 * DAY), true)
  assert.equal(visitValid(v, NOW + 30 * DAY + 1), false)
  // An expired credit is replaced by the next link.
  assert.equal(onJoinLink(visit(NOW - 31 * DAY), NOW), 'record')
})

test('the staff code gives credit only when there is no valid credit', () => {
  assert.equal(onStaffCode(null, true, NOW), 'record')
  assert.equal(onStaffCode(null, false, NOW), 'ignore')
  assert.equal(onStaffCode(visit(NOW - DAY), true, NOW), 'keep')
  assert.equal(onStaffCode(visit(NOW - 40 * DAY), true, NOW), 'record')
})

test('no credit for pre-existing, staff, test or duplicate accounts; one credit per account', () => {
  const v = visit(NOW - DAY)
  assert.equal(linkCreditRefusal(facts(), v, staff), null)
  assert.equal(linkCreditRefusal(facts({ createdAt: new Date(NOW - 2 * DAY).toISOString() }), v, staff), 'before_link')
  assert.equal(linkCreditRefusal(facts({ isTest: true }), v, staff), 'test')
  assert.equal(linkCreditRefusal(facts({ role: 'admin' }), v, staff), 'not_member')
  assert.equal(linkCreditRefusal(facts({ mobiles: ['923215872222'] }), v, staff), 'staff_contact')
  assert.equal(linkCreditRefusal(facts({ email: 'Aseer@TutorMint.org' }), v, staff), 'staff_contact')
  assert.equal(linkCreditRefusal(facts({ isDuplicate: true }), v, staff), 'duplicate')
  assert.equal(linkCreditRefusal(facts({ alreadyCredited: true }), v, staff), 'already_credited')
  // The database holds one row per account (member_id is the primary key) and
  // every insert ignores a second one.
  const sql = read('supabase/migrations/175_staff_signups.sql')
  assert.ok(/staff_signup_credits \(\s*member_id\s+uuid primary key/.test(sql))
  const lib = read('lib/staffSignups.ts')
  assert.equal((lib.match(/onConflict: 'member_id', ignoreDuplicates: true/g) ?? []).length, 2)
})

test('claims: only accounts from the last 30 days with no credit; nobody decides their own claim', () => {
  assert.equal(claimRefusal(facts(), staff, NOW), null)
  assert.equal(claimRefusal(facts({ createdAt: new Date(NOW - CLAIM_WINDOW_MS - DAY).toISOString() }), staff, NOW), 'too_old')
  assert.equal(claimRefusal(facts({ alreadyCredited: true }), staff, NOW), 'already_credited')
  assert.equal(claimRefusal(facts({ isTest: true }), staff, NOW), 'test')
  assert.equal(creditRefusal(facts({ isDuplicate: true }), staff), 'duplicate')
  assert.equal(mayDecideClaim('aqsa', 'aseer'), true)
  assert.equal(mayDecideClaim('aqsa', 'aqsa'), false)
})

test('permissions: who claims, who decides, who sees everyone, Admin opens Staff activity', () => {
  const sees = (r: AdminRole) => roleSatisfies(r, SCREEN_ACCESS.staffActivity)
  assert.equal(sees('admin'), true)
  assert.equal(sees('owner'), true)
  assert.equal(sees('partner'), true)
  assert.equal(sees('operations'), false)
  assert.equal(sees('tuitions_staff'), false)
  // Staff activity stays view only: no write route under it.
  // Claim: the participants (Partner refused on the write).
  for (const r of ['admin', 'operations', 'tuitions_staff'] as AdminRole[]) assert.equal(roleMayWrite(r, SCREEN_ACCESS.staffSignupClaim), true, r)
  assert.equal(roleMayWrite('partner', SCREEN_ACCESS.staffSignupClaim), false)
  // Decide: Owner and Admin. Project Managers view only.
  assert.equal(roleMayWrite('owner', SCREEN_ACCESS.staffClaimsReview), true)
  assert.equal(roleMayWrite('admin', SCREEN_ACCESS.staffClaimsReview), true)
  assert.equal(roleMayWrite('partner', SCREEN_ACCESS.staffClaimsReview), false)
  assert.equal(roleSatisfies('partner', SCREEN_ACCESS.staffClaimsReview), true)
  assert.equal(roleSatisfies('operations', SCREEN_ACCESS.staffClaimsReview), false)
  assert.equal(roleSatisfies('tuitions_staff', SCREEN_ACCESS.staffClaimsReview), false)
  // Everyone on the board vs own row only.
  for (const r of ['owner', 'partner', 'admin']) assert.equal(seesEveryone(r), true, r)
  for (const r of ['operations', 'tuitions_staff']) assert.equal(seesEveryone(r), false, r)
  const decide = read('app/api/admin/staff-signups/claims/decide/route.ts')
  assert.ok(decide.includes('checkAdminRole(...SCREEN_ACCESS.staffClaimsReview)'))
  const claim = read('app/api/admin/staff-signups/claims/route.ts')
  assert.ok(claim.includes('checkAdminRole(...SCREEN_ACCESS.staffSignupClaim)'))
})

test('a participant cannot see another participant’s row or list (403)', () => {
  assert.equal(mayViewStaff({ id: 'aseer', adminRole: 'tuitions_staff' }, 'aseer'), true)
  assert.equal(mayViewStaff({ id: 'aseer', adminRole: 'tuitions_staff' }, 'zubia'), false)
  assert.equal(mayViewStaff({ id: 'aqsa', adminRole: 'admin' }, 'zubia'), true)
  const lib = read('lib/staffSignups.ts')
  assert.ok(lib.includes("if (!everyone && s.id !== viewer.id) continue"))
  assert.ok(lib.includes("total: everyone ? boardRow('team', 'Team total', visible, period, nowMs) : null"))
  assert.ok(lib.includes("staffId === 'team' ? !seesEveryone(viewer.adminRole) : !mayViewStaff(viewer, staffId)"))
  assert.ok(lib.includes("return { ok: false, status: 403, error: 'You can only see your own sign-ups.' }"))
  const route = read('app/api/admin/staff-signups/list/route.ts')
  assert.ok(route.includes('{ status: result.status }'))
  assert.ok(route.includes('mobile: maskMobile(a.mobile)'))
})

test('the link credit survives the return-to through register and onboarding', () => {
  const join = read('app/join/[slug]/route.ts')
  assert.ok(join.includes("safeReturnTo(url.searchParams.get('next'))"))
  assert.ok(join.includes("dest.searchParams.set('next', next)"))
  assert.ok(join.includes('maxAge: Math.floor(CREDIT_MS / 1000)'))
  assert.ok(join.includes('httpOnly: true'))
  // An unknown slug still goes to /register (no error page).
  assert.ok(join.indexOf('NextResponse.redirect(dest, 307)') < join.indexOf('recordJoinVisit('))
  // The credit is read when the account is created on both paths.
  const reg = read('app/api/auth/register/route.ts')
  assert.equal((reg.match(/await creditNewAccount\(/g) ?? []).length, 2)
  assert.ok(reg.includes('staffCode: z.string().trim().max(40).optional()'))
  const verify = read('app/api/auth/register/verify/route.ts')
  assert.ok(verify.includes('await creditNewAccount(result.userId, jar.get(STAFF_REF_COOKIE)?.value ?? null)'))
  // The return-to rides along untouched to onboarding.
  const next = '/tuitions/lahore/home-tutor-abc?apply=1'
  assert.equal(safeReturnTo(next), next)
  assert.equal(newTutorDestination(next), `/tutor/onboarding?next=${encodeURIComponent(next)}`)
  assert.equal(safeReturnTo('//evil.com'), null)
  // The box is gone (owner, 23 Oct 2026); a ?ref or old ?code is sent hidden.
  const form = read('app/(site)/register/RegisterForm.tsx')
  assert.ok(!form.includes('Staff code (if someone helped you)'))
  assert.ok(form.includes('...(refCode ? { refCode } : {})'))
})

test('milestones: counted on the day they happened; list = board number', () => {
  const iso = (ms: number) => new Date(ms).toISOString()
  const accounts: CreditedAccount[] = [
    { memberId: 'a', staffId: 's', role: 'tutor', name: 'A', mobile: null, at: { signed_up: iso(NOW - 3600_000), mobile_verified: iso(NOW - 3000_000), onboarded: iso(NOW - 1000_000), paid: iso(NOW - 500_000) } },
    { memberId: 'b', staffId: 's', role: 'tutor', name: 'B', mobile: null, at: { signed_up: iso(NOW - DAY - 3600_000), mobile_verified: iso(NOW - DAY), paid: iso(NOW - DAY - 1000) } },
    { memberId: 'c', staffId: 's', role: 'tutor', name: 'C', mobile: null, at: { signed_up: iso(NOW - 10 * DAY) } },
    { memberId: 'd', staffId: 's', role: 'parent', name: 'D', mobile: null, at: { signed_up: iso(NOW - 2 * DAY), mobile_verified: iso(NOW - 2 * DAY), posted: iso(NOW - 3600_000) } },
  ]
  const row = boardRow('s', 'Aseer', accounts, 'today', NOW)
  assert.deepEqual(row.tutor, { signed_up: 1, mobile_verified: 1, onboarded: 1, paid: 1 })
  assert.deepEqual(row.parent, { signed_up: 0, mobile_verified: 0, posted: 1 })
  assert.equal(accountsAt(accounts.filter((a) => a.role === 'tutor'), 'paid', 'today', NOW).length, row.tutor.paid)
  // Yesterday up to the same time: B paid 1 s before this time yesterday.
  assert.deepEqual(row.paidChange, { direction: 'same', pct: 0 })
  assert.equal(boardRow('s', 'Aseer', accounts, 'last7', NOW).tutor.signed_up, 2)
  assert.equal(boardRow('s', 'Aseer', accounts, 'yesterday', NOW).tutor.paid, 1)
  assert.equal(currentStep(accounts[0]), 'Paid')
  assert.equal(currentStep(accounts[2]), 'Signed up')
  assert.equal(currentStep(accounts[3]), 'Posted a tuition')
  // Periods in Pakistan time.
  assert.equal(periodRange('today', NOW).start, Date.parse('2026-10-14T19:00:00Z'))
  assert.equal(periodRange('month', NOW).start, Date.parse('2026-09-30T19:00:00Z'))
  // Sort by Paid, highest first.
  const z = boardRow('z', 'Zubia', [], 'today', NOW)
  assert.deepEqual(sortBoardRows([z, row]).map((r) => r.staffId), ['s', 'z'])
})

test('{join_link} is filled with the sender’s own link, else the sign-up page', () => {
  assert.equal(fillJoinLink('Join: {join_link}', 'https://www.tutormint.org/join/aseer', 'https://x/register'), 'Join: https://www.tutormint.org/join/aseer')
  assert.equal(fillJoinLink('Join: {join_link}', null, 'https://x/register'), 'Join: https://x/register')
  assert.equal(hiringPost('Hiring in {city}: {join_link}', 'Lahore', 'https://www.tutormint.org/join/zubia'), 'Hiring in Lahore: https://www.tutormint.org/join/zubia')
  const sql = read('supabase/migrations/175_staff_signups.sql')
  assert.ok(sql.includes("where key = 'city_hiring_post'"))
  assert.ok(sql.includes("where key = 'seeded_tuition_live'"))
  // Templates for existing members are not touched.
  for (const k of ['documents_approved', 'profile_completion_nudge', 'applicants_forward', 'signup_profile_unfinished']) {
    assert.equal(sql.includes(`key = '${k}'`), false, k)
  }
})

test('no prices or amounts on the board; mobiles masked', () => {
  for (const f of ['app/admin/team-activity/PaidTab.tsx', 'app/admin/team-activity/accounts/page.tsx', 'app/admin/team-activity/claims/page.tsx', 'app/admin/team-activity/page.tsx', 'app/api/admin/team-activity/route.ts']) {
    const s = read(f)
    assert.equal(/Rs\.?\s|PKR|amount_pkr|price_pkr/.test(s), false, f)
  }
  // The lists behind the numbers show the same columns as My sign-ups (owner,
  // 16 Oct 2026) — the full phone, never a CNIC, document or payment detail.
  assert.ok(read('app/admin/team-activity/accounts/page.tsx').includes('rowsForAccounts(result.accounts, await senderRefCode(actor.id))'))
  assert.ok(read('app/admin/team-activity/claims/page.tsx').includes('maskMobile(c.memberMobile)'))
})
