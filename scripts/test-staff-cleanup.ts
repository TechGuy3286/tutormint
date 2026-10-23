// scripts/test-staff-cleanup.ts — Staff clean-up, Aqsa as Supervisor,
// hidden-parent tuitions, sign-up credit and form fixes (owner, 24 Oct 2026).
//   npm run test:staffcleanup
// Pure rules plus source checks of the wiring. The database half (the trigger
// that hides and restores a parent's tuitions) is proved by
// scripts/apply-migration-198.ts, and live by test:staffcleanup:live.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import {
  hiddenTuitionTarget,
  isHiddenTuition,
  NO_LONGER_AVAILABLE,
  NO_LONGER_AVAILABLE_TUTOR,
  parentCardResolves,
  parentHideReason,
  tuitionSlugOf,
} from '../lib/hiddenTuitionCore'
import { tuitionPublicState } from '../lib/tuitionStatus'
import { tuitionIndexable } from '../lib/seo/indexable'
import { dueState, todoBadgeCount } from '../lib/applicationFollowUpCore'
import { defaultFilter, itemOverdue, mayEditStage, type BoardItem } from '../lib/applicationStageCore'
import { forwardOverdue, paidCounts, type PaidApp } from '../lib/paidTutorsCore'
import { canRestore, formerStaffName, planStaffCleanup, restoreRoleFor, type StaffAccount } from '../lib/formerStaffCore'
import {
  roleMayWrite,
  roleSatisfies,
  SCREEN_ACCESS,
  seesAllStaffLists,
  supervisorMayChangeCity,
  supervisorMayChangeTuition,
  type AdminRole,
} from '../lib/adminAccessCore'
import { buildTeamOverview, countByOwner, followUpWindows } from '../lib/teamOverviewCore'
import { ADMIN_STAFF_ID, CLAIMS_OPEN, isActiveParticipant, sourceRow, type CreditedAccount } from '../lib/staffSignupsCore'
import { defaultRegisterRole } from '../lib/authRoutes'
import { joinHrefForPath, PARENT_SIGNUP_HREF, POST_TUITION_HREF, postTuitionHref, TUTOR_SIGNUP_HREF } from '../lib/signupLinks'
import { BUTTON_NOT_READY, BUTTON_READY, registerHint, registerReady } from '../lib/registerFormCore'

const read = (p: string) => readFileSync(p, 'utf8')
const NOW = Date.parse('2026-10-24T09:00:00Z')
const DAY = 86_400_000

// --------------------------------------------------------------- Part A ----

test('a hidden tuition is never indexable, has no JobPosting and is out of the sitemap', () => {
  assert.equal(isHiddenTuition('hidden'), true)
  assert.equal(isHiddenTuition('open'), false)
  const s = tuitionPublicState('hidden', null, NOW)
  assert.equal(s.indexable, false)
  assert.equal(s.emitJobPosting, false)
  assert.equal(s.inSitemap, false)
  assert.equal(s.acceptsApplications, false)
  assert.equal(tuitionIndexable({ status: 'hidden', pausedAt: null } as never), false)
  // The sitemap function reads status; 'hidden' is neither open nor paused.
  const sql = read('supabase/migrations/198_staff_cleanup_hidden_tuitions.sql')
  assert.match(sql, /status = 'hidden'/)
})

test('a hidden tuition 301-redirects to its city page, else Browse tuitions', () => {
  assert.equal(hiddenTuitionTarget('Hyderabad', true), '/tuition-jobs/hyderabad')
  assert.equal(hiddenTuitionTarget('Hyderabad', false), '/browse/tuitions')
  assert.equal(hiddenTuitionTarget(null, true), '/browse/tuitions')
  assert.equal(tuitionSlugOf('/tuitions/hyderabad/early-years-teacher-required-the-spirit-sc-15f0b8'), 'early-years-teacher-required-the-spirit-sc-15f0b8')
  assert.equal(tuitionSlugOf('/tuition-jobs/hyderabad'), null)
  const proxy = read('proxy.ts')
  assert.match(proxy, /hiddenTuitionRedirectPath\(request\.nextUrl\.pathname\)/)
  assert.match(proxy, /NextResponse\.redirect\(target, 301\)/)
  const page = read('app/(site)/tuitions/[city]/[slug]/page.tsx')
  assert.match(page, /if \(isHiddenTuition\(job\.status\)\) permanentRedirect\(await hiddenTuitionTargetFor\(job\.city\)\)/)
  assert.match(page, /if \(!job \|\| isHiddenTuition\(job\.status\)\) \{\s*return \{ title: pageTitle\('Tuition'\), robots: \{ index: false/)
})

test('hidden, test, suspended and banned parents hide their tuitions; un-hiding restores (TS mirror of the SQL rule)', () => {
  assert.equal(parentHideReason({ hidden_from_public: true }), 'parent_hidden')
  assert.equal(parentHideReason({ is_test_name: true }), 'parent_test')
  assert.equal(parentHideReason({ is_suspended: true }), 'parent_suspended')
  assert.equal(parentHideReason({ is_banned: true }), 'parent_banned')
  assert.equal(parentHideReason({}), null)
  const sql = read('supabase/migrations/198_staff_cleanup_hidden_tuitions.sql')
  // Restore puts back the status each tuition had; nothing is deleted.
  assert.match(sql, /set status = coalesce\(hidden_prev_status, 'open'\)/)
  assert.doesNotMatch(sql, /\bdelete from\b/i)
  assert.match(sql, /after update of is_banned, is_suspended, hidden_from_public, full_name on public\.profiles/)
})

test('no public page links to a parent card that 404s', () => {
  assert.equal(parentCardResolves({ role: 'parent' }), true)
  assert.equal(parentCardResolves({ role: 'academy' }), true)
  assert.equal(parentCardResolves({ role: 'parent', is_suspended: true }), false)
  assert.equal(parentCardResolves({ role: 'parent', is_banned: true }), false)
  assert.equal(parentCardResolves({ role: 'parent', hidden_from_public: true }), false)
  assert.equal(parentCardResolves({ role: 'tutor' }), false)
  assert.equal(parentCardResolves(null), false)
  // The page and every link read the same rule.
  assert.match(read('lib/publicParent.ts'), /parentCardResolves\(profile/)
  assert.match(read('lib/jobFeed.ts'), /publicCard: parentCardResolves\(p/)
  assert.match(read('components/JobCard.tsx'), /job\.parent_id && job\.parent_public \?/)
  const page = read('app/(site)/tuitions/[city]/[slug]/page.tsx')
  const links = page.match(/href=\{`\/parent\/\$\{job\.parent_id\}`\}/g) ?? []
  assert.equal(links.length, 1)
  assert.match(page, /\{job\.parent_public \? \(\s*<Link\s*href=\{`\/parent\/\$\{job\.parent_id\}`\}/)
})

const item = (over: Partial<BoardItem> = {}): BoardItem => ({
  id: 'a1',
  stage: 'applied',
  stageChangedAt: new Date(NOW - 5 * DAY).toISOString(),
  ownerId: 'staff-1',
  createdAt: new Date(NOW - 5 * DAY).toISOString(),
  jobCreatedAt: new Date(NOW - 5 * DAY).toISOString(),
  ...over,
})

test('applications on a hidden tuition are marked, never overdue, never in To do or a badge', () => {
  const live = item()
  const gone = item({ id: 'a2', unavailable: true })
  assert.equal(dueState(live, [], NOW).overdue, 'forward_overdue')
  const d = dueState(gone, [], NOW)
  assert.equal(d.tab, 'sent')
  assert.equal(d.overdue, null)
  assert.equal(d.unavailable, true)
  assert.equal(itemOverdue(gone, NOW), null)
  const both = [live, gone].map((i) => ({ ...i, due: dueState(i, [], NOW) }))
  assert.equal(todoBadgeCount(both, { id: 'staff-1', adminRole: 'tuitions_staff' }), 1)
  assert.equal(NO_LONGER_AVAILABLE, 'Tuition no longer available')
  assert.equal(NO_LONGER_AVAILABLE_TUTOR, 'This tuition is no longer available')
  // Paid tutors: never waiting to forward, never a red rule.
  const app: PaidApp = { jobId: 'j', stage: 'applied', createdAt: new Date(NOW - 5 * DAY).toISOString(), stageChangedAt: null, jobCreatedAt: new Date(NOW - 5 * DAY).toISOString(), forwarded: false }
  assert.equal(forwardOverdue(app, NOW), true)
  assert.equal(forwardOverdue({ ...app, unavailable: true }, NOW), false)
  assert.equal(paidCounts([{ ...app, unavailable: true }]).waitingToForward, 0)
  // The tutor dashboard says it, in place of a stage.
  assert.match(read('components/tutor/MyApplicationsSection.tsx'), /c\.unavailable \?/)
  assert.match(read('app/(site)/tutor/dashboard/applications/page.tsx'), /isHiddenTuition\(job\?\.status\)/)
  // The forward board and its badge leave them out.
  assert.match(read('lib/applicantForwards.ts'), /hiddenJobs\.has\(a\.job_id\)/)
})

// --------------------------------------------------------------- Part B ----

const acct = (id: string, name: string, adminRole: string | null, role = 'admin', ties = false): StaffAccount => ({ id, name, role, adminRole, hasStaffTies: ties, formerAt: null })
const KEEP = ['Khizra Danish', 'Aqsa Mughal', 'Mahnoor Amin', 'Zubia Bashir', 'Nabeel', 'Inzamam Ullah']

test('the clean-up keeps the named staff, never touches the Owner or Mohsin, and removes everyone else', () => {
  const accounts = [
    acct('o', 'Alee Sabeer', 'owner'),
    acct('m', 'Rai Mohsin Raza', 'partner'),
    acct('k', 'Khizra Danish', 'operations'),
    acct('a', 'Aqsa Mughal', 'admin'),
    acct('a2', 'Aqsa Mughal', null, 'tutor'), // her tutor account: not staff
    acct('mh', 'Mahnoor Amin', 'tuitions_staff'),
    acct('z', 'Zubia Bashir', 'tuitions_staff'),
    acct('n', 'Nabeel', 'tuitions_staff'),
    acct('i', 'Inzamam Ullah', 'tuitions_staff'),
    acct('j', 'Javeria Fiaz', 'operations'),
    acct('q', 'Qasim Shahid', null, 'parent', true), // a link, no admin access
    acct('s', 'Aseer Ul Hassan', null, 'parent', true),
    acct('p', 'Some Parent', null, 'parent'), // not staff at all
  ]
  const plan = planStaffCleanup(accounts, KEEP)
  assert.deepEqual(plan.untouched.map((a) => a.id).sort(), ['m', 'o'])
  assert.deepEqual(plan.keep.map((k) => k.account.id).sort(), ['a', 'i', 'k', 'mh', 'n', 'z'])
  assert.deepEqual(plan.remove.map((a) => a.id).sort(), ['j', 'q', 's'])
  assert.deepEqual(plan.unmatched, [])
})

test('a keep name matching no account, or two, changes nothing for that name', () => {
  const plan = planStaffCleanup([acct('n1', 'Nabeel', 'tuitions_staff'), acct('n2', 'Nabeel', 'operations'), acct('x', 'Zubia Bashir', 'tuitions_staff')], ['Nabeel', 'Khizra Danish', 'Zubia Bashir'])
  assert.deepEqual(plan.unmatched, [
    { name: 'Nabeel', matches: 2 },
    { name: 'Khizra Danish', matches: 0 },
  ])
  assert.deepEqual(plan.remove, [])
})

test('former staff keep their records, labelled, and only the Owner restores them', () => {
  assert.equal(formerStaffName('Javeria Fiaz', '2026-10-24'), 'Javeria Fiaz (former staff)')
  assert.equal(formerStaffName('Javeria Fiaz', null), 'Javeria Fiaz')
  assert.equal(canRestore({ role: 'parent', admin_role: null, former_staff_at: '2026-10-24' }), true)
  assert.equal(canRestore({ role: 'admin', admin_role: 'operations', former_staff_at: '2026-10-24' }), false)
  assert.equal(canRestore({ role: 'parent', admin_role: null, former_staff_at: null }), false)
  assert.equal(restoreRoleFor('operations'), 'operations')
  assert.equal(restoreRoleFor('owner'), 'tuitions_staff')
  const route = read('app/api/admin/members/restore-staff/route.ts')
  assert.match(route, /checkAdminRole\(\.\.\.SCREEN_ACCESS\.team\)/)
  assert.match(route, /refuseUnlessOwnerApproval/)
  assert.match(route, /requireFreshAuth/)
  const lib = read('lib/formerStaff.ts')
  assert.match(lib, /if \(actor\.adminRole !== 'owner'\) return \{ ok: false, status: 403/)
  assert.match(lib, /UNTOUCHABLE_ROLES\.has/)
  assert.match(lib, /revoke_user_sessions/)
  assert.match(lib, /from\('staff_join_links'\)\.update\(\{ deactivated_at: now \}\)/)
  assert.doesNotMatch(lib, /\.delete\(/)
  // A deactivated link credits nobody.
  assert.match(read('lib/staffSignups.ts'), /if \(!link \|\| link\.deactivated_at\) return null/)
  assert.equal(isActiveParticipant({ role: 'parent', adminRole: null }), false)
  // The page shows the button to the Owner only.
  assert.match(read('app/admin/users/[id]/page.tsx'), /canRestore=\{canApprove\(actor\.adminRole\) && canRestoreStaff/)
})

// --------------------------------------------------------------- Part C ----

const SUP: AdminRole = 'supervisor'

test('a Supervisor opens every screen Operations opens, sees all staff lists, and owner-only stays owner-only', () => {
  for (const [key, roles] of Object.entries(SCREEN_ACCESS)) {
    if (roles.includes('operations')) assert.ok(roles.includes(SUP), `${key} should admit supervisor`)
    if (roles.length === 0) assert.equal(roleSatisfies(SUP, roles), false, `${key} is owner-only`)
  }
  for (const key of ['applicantForwards', 'unpaidSignups', 'paidTutors', 'jobs', 'jobsPost', 'jobsMutate', 'teamOverview'] as const) {
    assert.equal(roleSatisfies(SUP, SCREEN_ACCESS[key]), true, key)
    assert.equal(roleMayWrite(SUP, SCREEN_ACCESS[key]), true, key)
  }
  assert.equal(roleSatisfies(SUP, SCREEN_ACCESS.team), false)
  assert.equal(roleSatisfies(SUP, SCREEN_ACCESS.cityOwners), false)
  assert.equal(roleSatisfies(SUP, SCREEN_ACCESS.finance), false)
  assert.equal(seesAllStaffLists(SUP), true)
  assert.equal(seesAllStaffLists('tuitions_staff'), false)
  assert.equal(defaultFilter({ id: 'a', adminRole: SUP }), 'all')
  assert.equal(defaultFilter({ id: 'n', adminRole: 'tuitions_staff' }), 'mine')
  assert.match(read('app/admin/paid-tutors/page.tsx'), /seesAllStaffLists\(actor\.adminRole\) \? 'all'/)
})

test('a Supervisor changes only their own tuitions and cities', () => {
  const me = { id: 'aqsa', adminRole: SUP }
  assert.equal(supervisorMayChangeTuition(me, 'aqsa'), true)
  assert.equal(supervisorMayChangeTuition(me, 'khizra'), false)
  assert.equal(supervisorMayChangeTuition(me, null), false)
  assert.equal(supervisorMayChangeCity(me, 'aqsa'), true)
  assert.equal(supervisorMayChangeCity(me, 'nabeel'), false)
  // Other roles keep the rule their own screen applies.
  assert.equal(supervisorMayChangeTuition({ id: 'k', adminRole: 'operations' }, 'someone'), true)
  assert.equal(mayEditStage(me, 'aqsa'), true)
  assert.equal(mayEditStage(me, 'khizra'), false)
  // Every write route that changes a tuition, an application or a tutor's
  // follow-ups calls the server guard.
  const guarded: [string, RegExp][] = [
    ['app/api/admin/jobs/action/route.ts', /refuseSupervisorTuitions\(gate\.actor, \[jobId\]\)/],
    ['app/api/admin/jobs/[id]/route.ts', /refuseSupervisorTuitions\(gate\.actor, \[id\]\)/],
    ['app/api/admin/jobs/[id]/notify/route.ts', /refuseSupervisorTuitions/],
    ['app/api/admin/jobs/paused/route.ts', /refuseSupervisorTuitions\(gate\.actor, parsed\.data\.ids\)/],
    ['app/api/admin/jobs/contact-number/route.ts', /refuseSupervisorTuitions/],
    ['app/api/admin/applications/follow-up/route.ts', /refuseSupervisorApplication/],
    ['app/api/admin/applications/whatsapp/route.ts', /refuseSupervisorApplication/],
    ['app/api/admin/applications/tutor-update/route.ts', /refuseSupervisorMember/],
    ['app/api/admin/applicant-forwards/forward/route.ts', /refuseSupervisorTuitions/],
    ['app/api/admin/applicant-forwards/outcome/route.ts', /refuseSupervisorTuitions/],
    ['app/api/admin/follow-ups/route.ts', /refuseSupervisorMember/],
    ['app/api/admin/follow-ups/tutor/route.ts', /refuseSupervisorMember/],
    ['app/api/admin/follow-ups/not-interested/route.ts', /refuseSupervisorMember/],
  ]
  for (const [file, re] of guarded) assert.match(read(file), re, file)
  // The stage route keeps mayEditStage (own tuitions only for everyone but the Owner).
  assert.match(read('lib/applicationTracking.ts'), /if \(!mayEditStage\(args\.actor, ownerId\)\)/)
  assert.match(read('supabase/migrations/198_staff_cleanup_hidden_tuitions.sql'), /'supervisor'/)
})

test('the Team overview counts per staff member', () => {
  const stamps = [
    { staffId: 'k', at: new Date(NOW - 60_000).toISOString() },
    { staffId: 'k', at: new Date(NOW - 3 * DAY).toISOString() },
    { staffId: 'n', at: new Date(NOW - 9 * DAY).toISOString() },
    { staffId: null, at: new Date(NOW - 60_000).toISOString() },
  ]
  const fu = followUpWindows(stamps, NOW)
  assert.deepEqual(fu.get('k'), { today: 1, last7: 2 })
  assert.equal(fu.get('n'), undefined)
  const red = countByOwner([{ o: 'n', r: true }, { o: 'n', r: false }, { o: null, r: true }], (x) => x.o, (x) => x.r)
  const rows = buildTeamOverview([{ id: 'k', name: 'Khizra' }, { id: 'n', name: 'Nabeel' }], new Map([['k', 3]]), red, fu)
  assert.deepEqual(rows[0], { staffId: 'k', name: 'Khizra', overdueApplications: 3, redPaidTutors: 0, followUpsToday: 1, followUps7: 2 })
  assert.deepEqual(rows[1], { staffId: 'n', name: 'Nabeel', overdueApplications: 0, redPaidTutors: 1, followUpsToday: 0, followUps7: 0 })
  assert.equal(roleSatisfies('owner', SCREEN_ACCESS.teamOverview), true)
  assert.equal(roleSatisfies('supervisor', SCREEN_ACCESS.teamOverview), true)
  assert.equal(roleSatisfies('operations', SCREEN_ACCESS.teamOverview), false)
  assert.equal(roleSatisfies('tuitions_staff', SCREEN_ACCESS.teamOverview), false)
  assert.match(read('app/admin/page.tsx'), /roleSatisfies\(actor\.adminRole, SCREEN_ACCESS\.teamOverview\) && <TeamOverviewCard \/>/)
})

// --------------------------------------------------------------- Part D ----

test('a sign-up with no valid staff link is credited to Admin (direct) and new claims are closed', () => {
  const acc = (staffId: string, source: CreditedAccount['source']): CreditedAccount => ({ memberId: Math.random().toString(), staffId, role: 'tutor', name: 'X', mobile: null, at: { signed_up: new Date(NOW).toISOString() }, source })
  const direct = [acc(ADMIN_STAFF_ID, 'direct'), acc(ADMIN_STAFF_ID, 'direct')]
  const row = sourceRow(ADMIN_STAFF_ID, 'Admin (direct)', direct, NOW)
  assert.equal(row.direct, 2)
  assert.equal(row.link, 0)
  assert.equal(sourceRow('s1', 'Nabeel', [acc('s1', 'link')], NOW).direct, 0)
  const lib = read('lib/staffSignups.ts')
  assert.match(lib, /if \(!visit \|\| !visitValid\(visit, nowMs\)\) return creditDirect\(admin, memberId, 'no_credit'\)/)
  assert.match(lib, /source: 'direct'/)
  // Old uncredited sign-ups are counted as Admin without rewriting them.
  assert.match(lib, /export async function loadAdminDirectAccounts/)
  assert.equal(CLAIMS_OPEN, false)
  assert.match(lib, /if \(!CLAIMS_OPEN\) return \{ ok: false, status: 410/)
  assert.match(read('app/admin/team-activity/PaidTab.tsx'), /isParticipant && CLAIMS_OPEN && <ClaimForm \/>/)
  assert.match(read('app/admin/team-activity/SourceTable.tsx'), /Direct \(Admin\)/)
})

// --------------------------------------------------------------- Part E ----

test('Tutor is the default; parent links open sign-up with Parent selected', () => {
  assert.equal(defaultRegisterRole(undefined, undefined), 'tutor')
  assert.equal(defaultRegisterRole('parent', undefined), 'parent')
  assert.equal(defaultRegisterRole(undefined, '/parent/dashboard/post-job'), 'parent')
  assert.equal(PARENT_SIGNUP_HREF, '/register?role=parent')
  assert.equal(TUTOR_SIGNUP_HREF, '/register')
  assert.equal(POST_TUITION_HREF, '/register?next=%2Fparent%2Fdashboard%2Fpost-job&role=parent')
  assert.equal(postTuitionHref({ city: 'Lahore', area: '' }), '/register?next=%2Fparent%2Fdashboard%2Fpost-job%3Fcity%3DLahore&role=parent')
  assert.equal(joinHrefForPath('/browse/tutors'), PARENT_SIGNUP_HREF)
  assert.equal(joinHrefForPath('/tutors/lahore/o-level-physics'), PARENT_SIGNUP_HREF)
  assert.equal(joinHrefForPath('/tutor/ali-raza-tutor'), PARENT_SIGNUP_HREF)
  assert.equal(joinHrefForPath('/tutor/dashboard'), TUTOR_SIGNUP_HREF)
  assert.equal(joinHrefForPath('/browse/tuitions'), TUTOR_SIGNUP_HREF)
  assert.equal(joinHrefForPath('/'), TUTOR_SIGNUP_HREF)
  // The form starts on the role the server decided.
  assert.match(read('app/(site)/register/RegisterForm.tsx'), /useState<Role \| null>\(initialRole\)/)
  // No public "Post a tuition" link skips sign-up's parent role.
  const publicFiles = ['lib/siteIdentity.ts', 'lib/faqContent.ts', 'lib/blog.ts', 'app/(site)/about/page.tsx', 'components/landing/LandingView.tsx', 'app/(site)/browse/tutors/page.tsx']
  for (const f of publicFiles) assert.doesNotMatch(read(f), /['"`]\/parent\/dashboard\/post-job/, f)
  assert.match(read('components/Footer.tsx'), /href: PARENT_SIGNUP_HREF/)
  assert.match(read('components/AuthCTA.tsx'), /href=\{joinHref\}/)
})

test('Create account: grey with a hint until ready, then brand red', () => {
  const empty = { role: 'tutor', fullName: '', identifier: '', password: '', acceptedTerms: false }
  assert.equal(registerReady(empty), false)
  assert.equal(registerHint(empty), 'Add your name, your mobile number or email and a password (8 or more characters) and tick the Terms box to continue')
  assert.equal(registerHint({ ...empty, identifier: '03001234567', acceptedTerms: true }), 'Add your name and a password (8 or more characters) to continue')
  assert.equal(registerHint({ role: 'tutor', fullName: 'Ali', identifier: '03001234567', password: 'longenough', acceptedTerms: false }), 'Tick the Terms box to continue')
  const full = { role: 'parent', fullName: 'Ali', identifier: 'a@b.co', password: 'longenough', acceptedTerms: true }
  assert.equal(registerReady(full), true)
  assert.equal(registerHint(full), null)
  assert.match(BUTTON_READY, /bg-tm-red/)
  assert.match(BUTTON_NOT_READY, /bg-gray-200 text-slate-700/)
  assert.doesNotMatch(BUTTON_NOT_READY, /opacity/)
  const form = read('app/(site)/register/RegisterForm.tsx')
  assert.match(form, /disabled=\{loading \|\| !ready\}/)
  assert.match(form, /\$\{ready \? BUTTON_READY : BUTTON_NOT_READY\}/)
  assert.doesNotMatch(form, /disabled:opacity-50/)
})

// ------------------------------------------------------------- privacy ----

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? filesUnder(p) : [p]
  })
}

test('no phone number or email is logged by the new code', () => {
  const files = [
    'lib/hiddenTuition.ts',
    'lib/hiddenTuitionCore.ts',
    'lib/hiddenTuitionRedirect.ts',
    'lib/formerStaff.ts',
    'lib/formerStaffCore.ts',
    'lib/supervisorScope.ts',
    'lib/teamOverview.ts',
    'lib/teamOverviewCore.ts',
    'lib/signupLinks.ts',
    'lib/registerFormCore.ts',
    'scripts/dataop-staff-cleanup.ts',
    'scripts/report-staff-cleanup.ts',
    ...filesUnder('app/api/admin/members/restore-staff'),
  ]
  for (const f of files) {
    for (const line of read(f).split('\n')) {
      if (!/console\.(log|info|warn|error|table)/.test(line)) continue
      assert.doesNotMatch(line, /phone|mobile|whatsapp|email|cnic/i, `${f}: ${line.trim()}`)
    }
  }
})
