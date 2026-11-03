// scripts/test-backend-support-overview.ts — npm run test:backendsupport
//
// Backend Support gets the Overview without money, Post a tuition and My
// sign-ups (owner, 3 Nov 2026). Pure rules plus source checks of the routes
// and pages that apply them. No database, no network.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  BACKEND_SUPPORT_OWN_POSTS,
  SCREEN_ACCESS,
  adminHomeFor,
  backendSupportMayEditTuition,
  canApprove,
  roleMayWrite,
  roleSatisfies,
  type AdminRole,
} from '../lib/adminAccessCore'
import { NAV_GROUPS } from '../lib/adminNav'
import { OVERVIEW_ITEMS, OVERVIEW_ITEM_KEYS, type OverviewItemKey } from '../lib/overviewItemsCore'
import { MONEY_ITEM_KEYS, isMoneyItem, overviewKeysWithoutMoney } from '../lib/overviewMoneyCore'
import { isActiveParticipant, isParticipantRole } from '../lib/staffSignupsCore'
import { OVERVIEW_SECTION_ORDER } from '../lib/overviewOrderCore'

const BS: AdminRole = 'backend_support'
const read = (p: string) => readFileSync(p, 'utf8')
const bsKeys = (): OverviewItemKey[] =>
  overviewKeysWithoutMoney(
    OVERVIEW_ITEM_KEYS.filter((k) => roleSatisfies(BS, SCREEN_ACCESS[OVERVIEW_ITEMS[k].screen])),
    roleSatisfies(BS, SCREEN_ACCESS.paymentAmounts),
  )

// ── Overview ─────────────────────────────────────────────────────────────
test('Overview: Backend Support opens it, with the allowed sections', () => {
  assert.ok(roleSatisfies(BS, SCREEN_ACCESS.overview))
  assert.equal(adminHomeFor(BS), '/admin')
  const keys = bsKeys()
  // Square cards for sign-ups and paid counts.
  for (const k of ['paid-today', 'signups-today', 'tutors', 'parents'] as const) assert.ok(keys.includes(k), `card ${k}`)
  // Today's to-do rows it works.
  for (const k of ['todo-uncontacted', 'todo-stuck', 'todo-payments'] as const) assert.ok(keys.includes(k), `to-do ${k}`)
  // Sign-up to payment: every step and every "lost" figure.
  for (const k of ['funnel-signed-up', 'funnel-mobile', 'funnel-onboarded', 'funnel-paid', 'lost-mobile', 'lost-onboarding', 'lost-payment'] as const) {
    assert.ok(keys.includes(k), `funnel ${k}`)
  }
  // Daily sign-up funnel + Where sign-ups came from.
  assert.ok(roleSatisfies(BS, SCREEN_ACCESS.signupFunnel))
  // Her KPI card on the Overview.
  const page = read('app/admin/page.tsx')
  assert.match(page, /actor\.adminRole === 'backend_support' \? await loadBackendSupportKpi\(actor\.id\)/)
  assert.match(page, /key: 'kpi'/)
  assert.ok(OVERVIEW_SECTION_ORDER.includes('signupToPayment') && OVERVIEW_SECTION_ORDER.includes('dailyFunnel') && OVERVIEW_SECTION_ORDER.includes('sources'))
  // The Overview nav item is shown.
  const labels = NAV_GROUPS.flatMap((g) => g.items).filter((i) => !i.screen || roleSatisfies(BS, SCREEN_ACCESS[i.screen])).map((i) => i.label)
  assert.ok(labels.includes('Overview'))
  // Refresh changes no data and returns no figures.
  assert.ok(roleSatisfies(BS, SCREEN_ACCESS.summaryRefresh))
  const refresh = read('app/api/admin/summary/refresh/route.ts')
  assert.doesNotMatch(refresh, /amount|pkr|rupee/i)
})

test('Overview: no money for Backend Support — UI and server', () => {
  const keys = bsKeys()
  for (const k of MONEY_ITEM_KEYS) assert.ok(!keys.includes(k), `no ${k}`)
  assert.ok(!keys.includes('revenue'))
  assert.ok(isMoneyItem('revenue') && isMoneyItem('todo-due'))
  // Every rupee the Overview loader makes is in a money item's block.
  const loader = read('lib/overviewItems.ts')
  const blocks = loader.split(/\n    case '/).slice(1)
  for (const b of blocks) {
    const key = b.slice(0, b.indexOf("'"))
    if (MONEY_ITEM_KEYS.includes(key as OverviewItemKey)) continue
    assert.doesNotMatch(b, /pkr\(|rupees\(|rupees: true|amount:\s/, `${key} carries no rupees`)
  }
  // Money roles, Team overview and Finance stay closed.
  for (const k of ['revenue', 'paymentAmounts', 'finance', 'teamOverview', 'reconciliation', 'paymentGateways', 'paymentsSwitches'] as const) {
    assert.ok(!roleSatisfies(BS, SCREEN_ACCESS[k]), `cannot open ${k}`)
  }
  // The Overview drops money items and the bank reader on the server.
  const page = read('app/admin/page.tsx')
  assert.match(page, /const seesMoney = roleSatisfies\(actor\.adminRole, SCREEN_ACCESS\.paymentAmounts\)/)
  assert.match(page, /overviewKeysWithoutMoney\(/)
  assert.match(page, /const readerState = seesMoney && /)
  assert.match(page, /roleSatisfies\(actor\.adminRole, SCREEN_ACCESS\.teamOverview\)/)
  // The list behind a number: a money list is a 404; amounts dropped otherwise.
  const list = read('app/admin/overview/[key]/page.tsx')
  assert.match(list, /if \(!seesMoney && isMoneyItem\(key\)\) notFound\(\)/)
  assert.match(list, /amount: seesMoney && r\.amount !== undefined/)
  assert.match(list, /\{seesMoney && list\.amount !== undefined/)
  // Payments stays status-only for her (amounts removed on the server).
  assert.match(read('app/admin/payments/page.tsx'), /withoutAmounts/)
})

// ── Post a tuition ─────────────────────────────────────────────────────────
test('Posting: same rights and checks as Tuitions staff', () => {
  for (const k of ['jobsPost', 'jobs'] as const) {
    assert.ok(roleSatisfies(BS, SCREEN_ACCESS[k]) && roleMayWrite(BS, SCREEN_ACCESS[k]), k)
  }
  // The post route and the Number-first check use the same gate.
  assert.match(read('app/api/admin/jobs/create/route.ts'), /checkAdminRole\(\.\.\.SCREEN_ACCESS\.jobsPost\)/)
  assert.match(read('app/api/admin/jobs/number-check/route.ts'), /checkAdminRole\(\.\.\.SCREEN_ACCESS\.jobsPost\)/)
  // createTeamJob records the poster (so "her own posts" is known).
  assert.match(read('lib/jobs.ts'), /await recordPoster\(admin, job\.id as string, actor\.id\)/)
  const labels = NAV_GROUPS.flatMap((g) => g.items).filter((i) => !i.screen || roleSatisfies(BS, SCREEN_ACCESS[i.screen])).map((i) => i.label)
  for (const l of ['Tuitions', 'Post a tuition']) assert.ok(labels.includes(l), l)
})

test('Posting: editing another staff member\'s tuition is refused', () => {
  const me = { id: 'bs-1', adminRole: BS }
  assert.equal(backendSupportMayEditTuition(me, 'bs-1'), true)
  assert.equal(backendSupportMayEditTuition(me, 'someone-else'), false)
  assert.equal(backendSupportMayEditTuition(me, null), false, 'a parent-posted or unknown poster is not hers')
  for (const r of ['owner', 'admin', 'operations', 'tuitions_staff', 'supervisor', 'partner'] as AdminRole[]) {
    assert.equal(backendSupportMayEditTuition({ id: 'x', adminRole: r }, 'someone-else'), true, `${r} keeps its own rule`)
  }
  assert.match(BACKEND_SUPPORT_OWN_POSTS, /only the tuitions they posted/)
  // Close / pause / resume stay closed.
  for (const k of ['jobsMutate', 'pausedTuitions', 'duplicatesMerge'] as const) assert.ok(!roleMayWrite(BS, SCREEN_ACCESS[k]), k)
  // Every tuition edit route applies the rule on the server.
  for (const f of ['app/api/admin/jobs/[id]/route.ts', 'app/api/admin/jobs/[id]/notify/route.ts', 'app/api/admin/jobs/contact-number/route.ts']) {
    assert.match(read(f), /await refuseBackendSupportTuitions\(gate\.actor, \[/, f)
  }
  const scope = read('lib/supervisorScope.ts')
  assert.match(scope, /if \(actor\.adminRole !== 'backend_support'\) return null/)
  assert.match(scope, /select\('job_id, posted_by'\)/)
  // Applications (any tuition) do NOT use the own-post rule.
  for (const f of ['app/api/admin/applicant-forwards/forward/route.ts', 'app/api/admin/applicant-forwards/outcome/route.ts']) {
    assert.doesNotMatch(read(f), /refuseBackendSupportTuitions/, f)
  }
  // Pages hide the edit controls for another person's tuition.
  assert.match(read('app/admin/jobs/[id]/edit/page.tsx'), /if \(!backendSupportMayEditTuition\(actor, posters\.get/)
  assert.match(read('app/admin/jobs/[id]/page.tsx'), /const canEditTeam = isTeamPosted && ownPostOk && /)
})

// ── My sign-ups ────────────────────────────────────────────────────────────
test('My sign-ups: her own link and her own data only', () => {
  assert.ok(roleSatisfies(BS, SCREEN_ACCESS.mySignups))
  assert.ok(isParticipantRole(BS))
  assert.ok(isActiveParticipant({ adminRole: BS, suspended: false }))
  assert.ok(!isActiveParticipant({ adminRole: BS, suspended: true }), 'a paused staff member earns nothing')
  // The page and the API read the signed-in actor's own id, never one from the request.
  assert.match(read('app/admin/my-signups/page.tsx'), /loadMySignupsPage\(actor\.id\)/)
  assert.match(read('app/api/admin/my-signups/route.ts'), /loadMySignupsPage\(gate\.actor\.id\)/)
  // Everyone else's lists stay closed to her.
  for (const k of ['staffSignupsAll', 'staffActivity', 'staffClaimsReview'] as const) assert.ok(!roleSatisfies(BS, SCREEN_ACCESS[k]), k)
  // The My link card (QR + counts) is on her Overview.
  assert.match(read('app/admin/page.tsx'), /<MyLinkCard staffId=\{actor\.id\} \/>/)
  // Self-referral rules apply to every participant's credit.
  assert.match(read('lib/staffSignups.ts'), /selfReferralFor\(/)
  const labels = NAV_GROUPS.flatMap((g) => g.items).filter((i) => !i.screen || roleSatisfies(BS, SCREEN_ACCESS[i.screen])).map((i) => i.label)
  assert.ok(labels.includes('My sign-ups'))
})

// ── Everything else stays blocked ──────────────────────────────────────────
test('Previously blocked actions are still refused', () => {
  for (const k of [
    'finance', 'revenue', 'paymentAmounts', 'paymentGateways', 'paymentsSwitches', 'paymentsSettings', 'paymentsApprove', 'paymentsRefund',
    'plans', 'plansMutate', 'jobsMutate', 'memberMerge', 'convertAccount', 'contactWithdraw', 'team', 'users', 'tutorEdit',
    'cnicRead', 'subjectsCore', 'notificationSettings', 'templateReview', 'supportNumber', 'secondRole', 'orphans', 'audit',
    'documentUnlock', 'documentRotate', 'cityOwners', 'cleanup', 'messaging', 'emailHealth', 'smsHealth', 'teamOverview',
  ] as const) {
    assert.ok(!roleMayWrite(BS, SCREEN_ACCESS[k]), `cannot change ${k}`)
  }
  assert.equal(canApprove(BS), false)
  // Suspend / ban / warn / mobile stay on `users`; erase and merge are Owner-only routes.
  assert.match(read('app/api/admin/members/route.ts'), /checkAdminRole\(\.\.\.SCREEN_ACCESS\.users\)/)
  // Receipts: only the bank-matched path, nothing else.
  assert.match(read('app/api/admin/payments/decide/route.ts'), /checkAdminRole\(\.\.\.SCREEN_ACCESS\.paymentsApprove, 'backend_support'\)/)
  // The Team page description.
  assert.match(read('app/admin/team/TeamClient.tsx'), /label: 'Backend Support', blurb: 'paid sign-ups, follow-ups and member support; can post tuitions; no finance or approvals'/)
})
