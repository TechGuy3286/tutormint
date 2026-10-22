// scripts/test-owner-approvals.ts — Owner-only approvals, the removed
// "Verifications & messages" tab, and four admin merges (owner, 15 Oct 2026).
//   npm run test:ownerapprovals
// Pure rules plus source checks that every approval route, screen and the
// database guard use them. The database guard itself is proven against the
// live schema by scripts/apply-migration-176.ts (always rolled back).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

import { canApprove, OWNER_ONLY_APPROVAL, roleMayWrite, roleSatisfies, SCREEN_ACCESS, type AdminRole } from '../lib/adminAccessCore'
import { DEFAULT_TAB, isRemovedTab, pickTab, staffActivityRedirect, tabsFor, TEAM_TABS } from '../lib/teamActivityCore'
import { followUpTabsFor, followUpsHref, onParentsTab, pickFollowUpTab } from '../lib/followUpsPageCore'
import { financeHref, isLegacyFinanceQuery } from '../lib/financeTabsCore'
import {
  feePayersInRange,
  feePayersSince,
  paidListHref,
  parsePayerPeriod,
  payerPeriodRange,
  pkDayStartMs,
  SIGNUPS_TODAY_HREF,
} from '../lib/overviewItemsCore'
import { NAV_GROUPS } from '../lib/adminNav'

const read = (p: string) => readFileSync(p, 'utf8')
const ROLES: AdminRole[] = ['owner', 'partner', 'admin', 'operations', 'tuitions_staff']
const NON_OWNERS: AdminRole[] = ['partner', 'admin', 'operations', 'tuitions_staff']

// ------------------------------------------------------------ 1. approvals

/** Every approval route and the words the guard is called with. */
const APPROVAL_ROUTES = [
  'app/api/admin/tutors/document-review/route.ts',
  'app/api/admin/parents/document-review/route.ts',
  'app/api/admin/tutors/moderate/route.ts',
  'app/api/admin/documents/unlock/route.ts',
  'app/api/admin/documents/rotate/route.ts',
  'app/api/admin/documents/read-cnic/route.ts',
  'app/api/admin/profile-photo/rotate/route.ts',
  'app/api/admin/profile-photo/crop/route.ts',
  'app/api/admin/payments/decide/route.ts',
  'app/api/admin/payments/bank-link/route.ts',
  'app/api/admin/staff-signups/claims/decide/route.ts',
]

/** What the guard answers: the Owner passes, every other role gets 403. */
function approvalStatus(role: AdminRole): 200 | 403 {
  return canApprove(role) ? 200 : 403
}

test('only the Owner may approve; every other role gets 403', () => {
  assert.equal(approvalStatus('owner'), 200)
  for (const r of NON_OWNERS) assert.equal(approvalStatus(r), 403, r)
  assert.equal(canApprove(null), false)
  assert.match(OWNER_ONLY_APPROVAL, /Only the Owner/)
})

test('every approval route calls the Owner-only guard after its gate and before it writes', () => {
  const guard = read('lib/ownerGuard.ts')
  assert.ok(guard.includes('if (canApprove(actor.adminRole)) return null'))
  assert.ok(guard.includes('{ status: 403 }'))
  assert.ok(guard.includes('await alertOwnerBlocked('), 'a refused attempt alerts the Owner')
  for (const f of APPROVAL_ROUTES) {
    const s = read(f)
    const gate = s.indexOf('checkAdminRole(')
    const g = s.search(/refuseUnlessOwnerApproval\(\s*gate\.actor/)
    assert.ok(gate > 0 && g > gate, `${f}: guard after the gate`)
    assert.ok(s.includes('if (notOwner) return notOwner'), `${f}: returns the 403`)
  }
  // Mixed routes guard only the approval actions.
  const mod = read('app/api/admin/tutors/moderate/route.ts')
  assert.ok(mod.includes("if (action === 'approve' || action === 'hold') {"))
  // Staff uploads and the CNIC number on the edit screen (owner, 19 Oct 2026):
  // the Owner always; others only while not approved and locked, waiting for
  // the Owner — scripts/test-admin-doc-upload.ts.
  assert.ok(read('app/api/admin/tutors/media/route.ts').includes('adminUploadDecision('))
  assert.ok(read('app/api/admin/tutors/edit/route.ts').includes('cnicNumberDecision('))
  const reader = read('app/api/admin/documents/read-cnic/route.ts')
  assert.ok(reader.indexOf("action === 'cached'") < reader.indexOf('refuseUnlessOwnerApproval(gate.actor'), 'check/cached stay readable')
  // No server actions exist anywhere that could bypass the routes.
  // (A 'use server' file would need the same guard.)
})

test('the blocked attempt raises the existing Owner alert', () => {
  const a = read('lib/ownerAlerts.ts')
  assert.ok(a.includes('const approval = params.problem === OWNER_ONLY_APPROVAL'))
  assert.ok(a.includes("'Blocked attempt at an Owner-only approval'"))
})

test('the database refuses a non-Owner staff token on the approval columns (migration 176)', () => {
  const sql = read('supabase/migrations/176_owner_only_approvals.sql')
  for (const col of ['cnic_number', 'cnic_verified_at', 'profile_pic_status', 'selfie_status', 'address_status', 'video_status', 'status is distinct from old.status']) {
    assert.ok(sql.includes(col), col)
  }
  assert.ok(sql.includes("caller_admin_role = 'owner'"))
  assert.ok(sql.includes('if caller is null then'), 'service role untouched')
  assert.ok(sql.includes("caller_role is distinct from 'admin'"), 'members untouched')
  for (const t of ['profiles', 'tutor_profiles', 'payments']) assert.ok(sql.includes(`before update on public.${t}`), t)
  assert.ok(/drop trigger if exists owner_only_approval/.test(sql), 'idempotent')
})

test('approval controls are hidden for non-Owners on every screen', () => {
  const ro = read('components/admin/ReadOnly.tsx')
  assert.ok(ro.includes('export function useCanApprove()'))
  assert.ok(read('app/admin/layout.tsx').includes('canApprove={canApprove(actor.adminRole)}'))
  const gated: [string, string][] = [
    ['components/admin/TutorDocumentReview.tsx', 'const canReview = canReviewProp && !readOnly && ownerApproves'],
    ['components/admin/ParentDocumentReview.tsx', 'const canReview = canReviewProp && !readOnly && ownerApproves'],
    ['components/admin/AdminCnicNumberBox.tsx', 'const mayWrite = canEdit && !readOnly && ownerApproves'],
    ['components/admin/UnlockDocButton.tsx', 'if (!canUnlock || readOnly || !ownerApproves) return null'],
    ['components/admin/DocumentViewer.tsx', '&& !readOnly && ownerApproves'],
    ['app/admin/tutors/videos/TutorModerationClient.tsx', '{ownerApproves && <>'],
    // The edit screen's upload sections are open to staff who edit tutors
    // (owner, 19 Oct 2026); only the Owner's upload is saved as approved.
    ['app/admin/tutors/[id]/TutorFieldEditor.tsx', "read.statusLabel === 'Approved'"],
    ['app/admin/payments/page.tsx', '&& canApproveRole(actor.adminRole)'],
    ['app/admin/team-activity/claims/page.tsx', '&& canApprove(actor.adminRole)'],
  ]
  for (const [f, needle] of gated) assert.ok(read(f).includes(needle), f)
})

test('Claims to review: Owner decides; Admin and Project Managers view', () => {
  assert.equal(roleSatisfies('admin', SCREEN_ACCESS.staffClaimsReview), true, 'Admin still opens the list')
  assert.equal(roleSatisfies('partner', SCREEN_ACCESS.staffClaimsReview), true)
  for (const r of NON_OWNERS) assert.equal(canApprove(r), false, r)
  assert.ok(read('app/api/admin/staff-signups/claims/decide/route.ts').includes('refuseUnlessOwnerApproval(gate.actor'))
})

test('Team page role descriptions', () => {
  const t = read('app/admin/team/TeamClient.tsx')
  assert.ok(t.includes("blurb: 'Posting tuitions, assisting, marketing, SEO; can view verification queues; approvals are Owner only'"))
  assert.ok(t.includes("blurb: 'edits tutors, parents and tuitions; approvals are Owner only; everything else view only; two-factor required'"))
  assert.equal(t.includes("'Posting tuitions, verifying,"), false)
})

// ------------------------------------------- 2. the removed Team activity tab

test('the Verifications & messages tab and its API are gone; old links land on Paid sign-ups', () => {
  assert.deepEqual(TEAM_TABS.map((t) => t.key), ['paid', 'posted'])
  for (const r of ROLES) assert.deepEqual(tabsFor(r), ['paid', 'posted'], r)
  assert.equal(isRemovedTab('verifications'), true)
  assert.equal(pickTab('owner', 'verifications'), DEFAULT_TAB)
  assert.equal(staffActivityRedirect(), '/admin/team-activity')
  const page = read('app/admin/team-activity/page.tsx')
  assert.ok(page.includes("if (isRemovedTab(sp.tab)) redirect(teamActivityHref('paid'))"))
  assert.equal(page.includes('VerificationsTab'), false)
  const api = read('app/api/admin/team-activity/route.ts')
  assert.ok(api.includes('if (isRemovedTab(raw))') && api.includes('{ status: 404 }'))
  assert.equal(api.includes('loadStaffActivity'), false)
  // The detail page keeps only tuitions posted.
  const detail = read('app/admin/team-activity/[id]/page.tsx')
  assert.ok(detail.includes("only={['posted']}") && detail.includes("metric: 'posted'"))
})

// ------------------------------------------------------------- 3. merges

test('Follow-ups: tabs per role; Tuitions staff see Tutors and Applications only', () => {
  // Applications (owner, 22 Oct 2026) sits next to Tutors for every role that posts.
  for (const r of ['owner', 'partner', 'admin', 'operations'] as AdminRole[]) {
    assert.deepEqual(followUpTabsFor(r), ['tutors', 'applications', 'parents', 'orphans'], r)
  }
  assert.deepEqual(followUpTabsFor('tuitions_staff'), ['tutors', 'applications'])
  assert.equal(pickFollowUpTab('tuitions_staff', 'parents'), 'tutors')
  assert.equal(pickFollowUpTab('admin', 'orphans'), 'orphans')
  // Every unfinished tutor is on Tutors only, an unconfirmed email included (21 Oct 2026).
  assert.equal(onParentsTab({ stage: 'profile_unfinished', role: 'tutor' }), false)
  assert.equal(onParentsTab({ stage: 'profile_unfinished', role: 'parent' }), true)
  assert.equal(onParentsTab({ stage: 'email_unconfirmed', role: 'tutor' }), false)
  assert.equal(onParentsTab({ stage: 'email_unconfirmed', role: 'parent' }), true)
  // Overview "Stuck in onboarding" keeps its filtered view.
  // …now the Stuck chip of the merged list (owner, 20 Oct 2026).
  assert.ok(read('lib/overviewItems.ts').includes("workHref: chipHref('stuck')"))
  assert.equal(SIGNUPS_TODAY_HREF, '/admin/follow-ups?filter=today')
})

test('retired routes redirect to the right tab or period, query kept', () => {
  assert.equal(followUpsHref('tutors', { filter: 'today' }), '/admin/follow-ups?filter=today')
  assert.equal(followUpsHref('parents', {}), '/admin/follow-ups?tab=parents')
  assert.equal(followUpsHref('orphans'), '/admin/follow-ups?tab=orphans')
  // Finance is ONE page now (owner, 21 Oct 2026): the old tab is dropped, the
  // month and range kept.
  assert.equal(financeHref({ tab: 'settlement', month: '2026-10' }), '/admin/finance?month=2026-10')
  assert.equal(financeHref({ tab: 'settlement', from: '2026-10-01', to: '2026-10-15' }), '/admin/finance?from=2026-10-01&to=2026-10-15')
  assert.equal(isLegacyFinanceQuery({ tab: 'settlement' }), true)
  assert.equal(isLegacyFinanceQuery({ month: '2026-10' }), false)
  assert.equal(paidListHref('month'), '/admin/overview/paid-today?period=month')
  assert.equal(paidListHref('today'), '/admin/overview/paid-today')
  const redirects: [string, string][] = [
    ['app/admin/users/unpaid-signups/page.tsx', "redirect(followUpsHref('tutors', await searchParams))"],
    ['app/admin/signups/page.tsx', "redirect(followUpsHref('parents', await searchParams))"],
    ['app/admin/orphans/page.tsx', "redirect(followUpsHref('orphans'))"],
    ['app/admin/finance/settlement/page.tsx', 'redirect(financeHref(await searchParams))'],
    ['app/admin/flags/page.tsx', "redirect('/admin/reports?tab=flags')"],
    ['app/admin/payments/payers/page.tsx', "redirect(paidListHref(sp.period ? parsePayerPeriod(sp.period) : 'month'))"],
    ['app/admin/staff-activity/page.tsx', 'redirect(staffActivityRedirect())'],
  ]
  for (const [f, needle] of redirects) assert.ok(read(f).includes(needle), f)
  assert.ok(read('app/admin/payments/reconciliation/page.tsx').includes('permanentRedirect(`/admin/finance${q}`)'))
})

test('Finance tab permissions unchanged; settlement actions stay Owner only', () => {
  assert.deepEqual(SCREEN_ACCESS.finance, [])
  assert.equal(roleSatisfies('partner', SCREEN_ACCESS.finance), true, 'Project Manager views')
  assert.equal(roleMayWrite('partner', SCREEN_ACCESS.finance), false, 'Project Manager cannot change')
  for (const r of ['admin', 'operations', 'tuitions_staff'] as AdminRole[]) assert.equal(roleSatisfies(r, SCREEN_ACCESS.finance), false, r)
  assert.ok(read('app/admin/finance/page.tsx').includes('requireAdminRole(...SCREEN_ACCESS.finance)'))
  for (const f of ['credits', 'links']) {
    assert.ok(read(`app/api/admin/payments/settlement/${f}/route.ts`).includes('checkAdminRole(...SCREEN_ACCESS.finance)'), f)
  }
  assert.equal(existsSync('app/admin/finance/settlement/SettlementTab.tsx'), true)
})

test('Reports & flags: one page, both queues, same roles', () => {
  const p = read('app/admin/reports/page.tsx')
  assert.ok(p.includes('requireAdminRole(...SCREEN_ACCESS.reports)'))
  assert.ok(p.includes('<FlagQueue initial={rows} />') && p.includes('<ReportQueue'))
})

test('Paid today list: period switch with the Recent payers rule; today equals the card', () => {
  const now = Date.parse('2026-10-15T12:00:00Z')
  const day = 86_400_000
  const iso = (ms: number) => new Date(ms).toISOString()
  const rows = [
    { userId: 'a', approvedAt: iso(now - 3600_000), refundedAmountPkr: null, refundedAt: null },
    { userId: 'a', approvedAt: iso(now - 10 * day), refundedAmountPkr: null, refundedAt: null },
    { userId: 'b', approvedAt: iso(pkDayStartMs(now) - 3600_000), refundedAmountPkr: null, refundedAt: null },
    { userId: 'c', approvedAt: iso(now - 2 * day), refundedAmountPkr: 199, refundedAt: iso(now) },
    { userId: null, approvedAt: iso(now - 100), refundedAmountPkr: null, refundedAt: null },
  ]
  const monthStart = payerPeriodRange('month', now).start
  const r = (p: 'today' | 'yesterday' | 'last7' | 'month') => {
    const g = payerPeriodRange(p, now)
    return feePayersInRange(rows, g.start, g.end).map((x) => x.userId)
  }
  assert.deepEqual(r('today'), feePayersSince(rows, now, monthStart).today.map((x) => x.userId))
  assert.deepEqual(r('today'), ['a'])
  assert.deepEqual(r('yesterday'), ['b'])
  assert.deepEqual(r('last7').sort(), ['a', 'b'])
  assert.equal(parsePayerPeriod('nonsense'), 'today')
})

test('sidebar after the merges; group order kept', () => {
  assert.deepEqual(NAV_GROUPS.map((g) => g.title), ['Overview', 'People', 'Tuitions', 'Marketplace', 'Trust', 'Growth'])
  const labels = NAV_GROUPS.flatMap((g) => g.items.map((i) => `${g.title}:${i.label}`))
  for (const gone of ['Abandoned signups', 'Unpaid signups', 'Settlement check', 'Flagged messages', 'Reports', 'Staff activity', 'Tuition posting activity']) {
    assert.equal(labels.some((l) => l.endsWith(`:${gone}`)), false, gone)
  }
  for (const here of ['People:Follow-ups', 'Marketplace:Finance', 'Trust:Reports & flags', 'Tuitions:Team activity']) {
    assert.ok(labels.includes(here), here)
  }
  const follow = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.label === 'Follow-ups')!
  for (const r of ROLES) assert.equal(roleSatisfies(r, SCREEN_ACCESS[follow.screen!]), true, `${r} sees Follow-ups`)
})
