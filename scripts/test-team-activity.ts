// scripts/test-team-activity.ts — Tuitions → Team activity (owner, 15 Oct 2026).
//   npm run test:teamactivity
// One page in place of Tuition posting activity + Staff activity: tab
// visibility and 403s per role, old URLs redirect to the right tab, Paid
// sign-ups sort and Team total, In progress never added to Paid, one sidebar
// entry per allowed role, and the sidebar no longer a one-screen fixed box.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  DEFAULT_TAB,
  mayOpenTab,
  pickTab,
  postingActivityRedirect,
  staffActivityRedirect,
  tabsFor,
  teamActivityHref,
  withQuery,
} from '../lib/teamActivityCore'
import {
  boardRow,
  inProgressAt,
  sortBoardRows,
  type CreditedAccount,
} from '../lib/staffSignupsCore'
import { roleSatisfies, SCREEN_ACCESS, type AdminRole } from '../lib/adminAccessCore'
import { NAV_GROUPS } from '../lib/adminNav'

const read = (p: string) => readFileSync(p, 'utf8')
const NOW = Date.parse('2026-10-15T12:00:00Z') // 17:00 PKT
const DAY = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()
const ROLES: AdminRole[] = ['owner', 'partner', 'admin', 'operations', 'tuitions_staff']

test('tab visibility per role (two tabs; Verifications & messages removed)', () => {
  for (const r of ROLES) {
    assert.deepEqual(tabsFor(r), ['paid', 'posted'], r)
    assert.equal(mayOpenTab(r, 'paid'), true, r)
    // The removed tab in the URL renders the default tab.
    assert.equal(pickTab(r, 'verifications'), 'paid', r)
  }
  assert.equal(DEFAULT_TAB, 'paid')
  assert.equal(pickTab('admin', 'nonsense'), 'paid')
  assert.deepEqual(tabsFor(null), [])
})

test('the API answers 403 for a tab the role may not open, and gates the page first', () => {
  const route = read('app/api/admin/team-activity/route.ts')
  assert.ok(route.includes('checkAdminRole(...SCREEN_ACCESS.tuitionPosting)'))
  assert.ok(route.includes('if (!mayOpenTab(gate.actor.adminRole, raw)) {'))
  assert.ok(route.includes('{ status: 403 }'))
  const page = read('app/admin/team-activity/page.tsx')
  assert.ok(page.includes('requireAdminRole(...SCREEN_ACCESS.tuitionPosting)'))
  assert.ok(page.includes('pickTab(actor.adminRole, sp.tab)'))
  // The staff detail page: Owner, Project Managers and Admin.
  assert.ok(read('app/admin/team-activity/[id]/page.tsx').includes('requireAdminRole(...SCREEN_ACCESS.staffActivity)'))
  // No amounts on any of it.
  for (const f of ['app/admin/team-activity/page.tsx', 'app/admin/team-activity/PaidTab.tsx', 'app/api/admin/team-activity/route.ts']) {
    assert.equal(/Rs\.?\s|PKR|amount_pkr|price_pkr/.test(read(f)), false, f)
  }
})

test('old URLs redirect to the matching tab', () => {
  assert.equal(postingActivityRedirect({}), '/admin/team-activity?tab=posted')
  assert.equal(postingActivityRedirect({ tab: 'signups' }), '/admin/team-activity')
  assert.equal(postingActivityRedirect({ tab: 'signups', period: 'last7' }), '/admin/team-activity?period=last7')
  assert.equal(staffActivityRedirect(), '/admin/team-activity')
  assert.equal(
    withQuery('/admin/team-activity/accounts', { staff: 'x', role: 'tutor', step: 'paid', period: 'month' }),
    '/admin/team-activity/accounts?staff=x&role=tutor&step=paid&period=month',
  )
  assert.equal(teamActivityHref('paid'), '/admin/team-activity')
  assert.ok(read('app/admin/jobs/posting-activity/page.tsx').includes('redirect(postingActivityRedirect('))
  assert.ok(read('app/admin/jobs/posting-activity/signups/page.tsx').includes('/accounts'))
  assert.ok(read('app/admin/jobs/posting-activity/claims/page.tsx').includes('/claims'))
  assert.ok(read('app/admin/staff-activity/page.tsx').includes('redirect(staffActivityRedirect())'))
  assert.ok(read('app/admin/staff-activity/[id]/page.tsx').includes('redirect(withQuery('))
})

const tutor = (id: string, at: CreditedAccount['at']): CreditedAccount => ({ memberId: id, staffId: 's', role: 'tutor', name: id, mobile: null, at })

test('In progress never adds to Paid; a paid tutor is never in progress', () => {
  const accounts: CreditedAccount[] = [
    tutor('paid-today', { signed_up: iso(NOW - 3600_000), mobile_verified: iso(NOW - 3000_000), onboarded: iso(NOW - 2000_000), paid: iso(NOW - 1000_000) }),
    tutor('onboarded', { signed_up: iso(NOW - 3600_000), mobile_verified: iso(NOW - 3000_000), onboarded: iso(NOW - 2000_000) }),
    tutor('mobile', { signed_up: iso(NOW - 3600_000), mobile_verified: iso(NOW - 3000_000) }),
    tutor('signed', { signed_up: iso(NOW - 3600_000) }),
    // Signed up today, paid last week? impossible; paid long ago and signed up long ago:
    tutor('old-paid', { signed_up: iso(NOW - 20 * DAY), paid: iso(NOW - 19 * DAY) }),
  ]
  const row = boardRow('s', 'Aseer', accounts, 'today', NOW)
  assert.equal(row.tutor.paid, 1)
  assert.deepEqual(row.inProgress, { signed_up: 3, mobile_verified: 2, onboarded: 1 })
  // The in-progress numbers count only unpaid tutors and match their list.
  assert.equal(inProgressAt(accounts, 'signed_up', 'today', NOW).some((a) => a.at.paid), false)
  assert.equal(inProgressAt(accounts, 'onboarded', 'today', NOW).length, row.inProgress.onboarded)
  // Paid stays the paid count whatever the in-progress block holds.
  const more = [...accounts, tutor('x', { signed_up: iso(NOW - 100) }), tutor('y', { signed_up: iso(NOW - 100) })]
  assert.equal(boardRow('s', 'Aseer', more, 'today', NOW).tutor.paid, 1)
  // A parent is never in the tutor in-progress block.
  const parent: CreditedAccount = { memberId: 'p', staffId: 's', role: 'parent', name: 'p', mobile: null, at: { signed_up: iso(NOW - 100) } }
  assert.equal(boardRow('s', 'Aseer', [parent], 'today', NOW).inProgress.signed_up, 0)
})

test('Paid sign-ups sort by paid first; the Team total is the sum of paid', () => {
  const a = boardRow('a', 'Aseer', [tutor('1', { signed_up: iso(NOW - 100), paid: iso(NOW - 50) })], 'today', NOW)
  const z = boardRow('z', 'Zubia', [tutor('2', { signed_up: iso(NOW - 100) }), tutor('3', { signed_up: iso(NOW - 100) })], 'today', NOW)
  // Zubia has more sign-ups but no paid one: Aseer is first.
  assert.deepEqual(sortBoardRows([z, a]).map((r) => r.staffId), ['a', 'z'])
  const all = [tutor('1', { signed_up: iso(NOW - 100), paid: iso(NOW - 50) }), tutor('2', { signed_up: iso(NOW - 100), paid: iso(NOW - 40) }), tutor('3', { signed_up: iso(NOW - 100) })]
  const total = boardRow('team', 'Team total', all, 'today', NOW)
  assert.equal(total.tutor.paid, 2)
  assert.equal(total.inProgress.signed_up, 1)
  const tab = read('app/admin/team-activity/PaidTab.tsx')
  assert.ok(tab.includes('Only paid tutor sign-ups count as results.'))
  assert.ok(tab.includes('In progress (not counted)'))
  assert.ok(tab.includes('Parents (for information)'))
  assert.ok(tab.includes('Claims to review ('))
  // The paid column comes before the change column.
  assert.ok(tab.indexOf('>Paid sign-ups<') < tab.indexOf('>Paid: Today vs Yesterday<'))
})

test('sidebar: one Team activity entry per allowed role; the old entries are gone', () => {
  const items = NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title })))
  const team = items.filter((i) => i.label === 'Team activity')
  assert.equal(team.length, 1)
  assert.equal(team[0].group, 'Tuitions')
  assert.equal(team[0].href, '/admin/team-activity')
  assert.equal(items.some((i) => i.label === 'Staff activity' || i.label === 'Tuition posting activity'), false)
  assert.equal(items.some((i) => i.href === '/admin/staff-activity' || i.href === '/admin/jobs/posting-activity'), false)
  for (const r of ROLES) {
    const visible = items.filter((i) => !i.screen || roleSatisfies(r, SCREEN_ACCESS[i.screen]))
    assert.equal(visible.filter((i) => i.label === 'Team activity').length, 1, r)
  }
  // Group order unchanged.
  assert.deepEqual(NAV_GROUPS.map((g) => g.title), ['Overview', 'Verification', 'People', 'Tuitions', 'Marketplace', 'Trust', 'Growth'])
})

test('sidebar is a full-height column with a sticky, self-scrolling panel', () => {
  const shell = read('components/admin/AdminShell.tsx')
  assert.equal(shell.includes('fixed inset-y-0 left-0 z-30'), false, 'no one-screen fixed sidebar')
  assert.ok(shell.includes('<div className="sticky top-0 flex h-screen flex-col'))
  assert.ok(shell.includes('min-h-0 flex-1 overflow-y-auto'))
  assert.ok(shell.includes('min-h-screen bg-tm-bg text-slate-700 md:flex'))
  // The mobile drawer stays a fixed overlay.
  assert.ok(shell.includes('fixed inset-y-0 left-0 z-50 flex w-64'))
})
