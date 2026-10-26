/**
 * scripts/test-manager-view.ts — the Manager role (internal 'supervisor';
 * owner, 27 Oct 2026): shown as "Manager"; sees every staff member's data in
 * full on Team activity → Paid sign-ups, Team overview, Applications,
 * Follow-ups, Paid tutors and Tuitions; still CHANGES only their own items.
 * Invented ids only.   npm run test:managerview
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  ROLE_LABEL,
  SCREEN_ACCESS,
  SUPERVISOR_OWN_ONLY,
  roleBadge,
  roleSatisfies,
  seesAllStaffLists,
  supervisorMayChangeCity,
  supervisorMayChangeTuition,
} from '../lib/adminAccessCore'
import { mayViewStaff, seesEveryone } from '../lib/staffSignupsCore'
import { targetScope } from '../lib/staffTargetsCore'
import { defaultFilter, mayEditStage } from '../lib/applicationStageCore'
import { followUpTabsFor } from '../lib/followUpsPageCore'

const read = (p: string) => readFileSync(p, 'utf8')
const MANAGER = { id: 'm-1111', adminRole: 'supervisor' as const }
const OTHER = 'o-2222'

test('the role is shown as "Manager" everywhere, never "Supervisor" or "Admin"', () => {
  assert.equal(ROLE_LABEL.supervisor, 'Manager')
  assert.equal(roleBadge('supervisor'), 'Manager') // what other staff see (was "Admin")
  assert.equal(roleBadge('supervisor', 'owner'), 'Manager')
  assert.equal(roleBadge('owner'), 'Project Manager')
  assert.equal(roleBadge('partner'), 'Project Manager')
  assert.equal(roleBadge('operations'), 'Admin')
  assert.ok(SUPERVISOR_OWN_ONLY.startsWith('Managers can change only'))
  const team = read('app/admin/team/TeamClient.tsx')
  assert.ok(!/label: 'Supervisor'|: 'Supervisor',/.test(team))
  assert.ok(team.includes("{ code: 'supervisor', label: 'Manager'"))
  assert.ok(!read('lib/notify/templates.ts').includes("? 'Supervisor'"))
})

test('Team activity → Paid sign-ups: every staff row, the source columns, the team', () => {
  assert.equal(seesEveryone('supervisor'), true)
  assert.equal(targetScope('supervisor', false), 'everyone')
  assert.equal(targetScope('supervisor', true), 'everyone')
  assert.equal(mayViewStaff(MANAGER, OTHER), true)
  assert.equal(mayViewStaff(MANAGER, 'team'), true)
  assert.ok(SCREEN_ACCESS.staffSignupsAll.includes('supervisor'))
  // Staff detail pages (tuitions posted per person) open for a Manager too.
  assert.equal(roleSatisfies('supervisor', SCREEN_ACCESS.staffActivity), true)
  // The Sign-ups by source table (Direct, Link, Code, tutors paid 7/30/all time)
  // is cut by seesEveryone, so a Manager gets every row and the total.
  assert.ok(read('lib/staffSignups.ts').includes('const everyone = seesEveryone(viewer.adminRole)'))
  // …but claims are reviewed by the Owner and Admin only.
  assert.equal(roleSatisfies('supervisor', SCREEN_ACCESS.staffClaimsReview), false)
  assert.ok(read('app/admin/team-activity/PaidTab.tsx').includes('SCREEN_ACCESS.staffClaimsReview'))
  // Other staff still see only their own row.
  assert.equal(seesEveryone('operations'), false)
  assert.equal(targetScope('tuitions_staff', true), 'target_self')
})

test('Team overview: opens for a Manager and is not cut to their own row', () => {
  assert.equal(roleSatisfies('supervisor', SCREEN_ACCESS.teamOverview), true)
  assert.ok(read('components/admin/TeamOverviewCard.tsx').includes('loadTeamOverview()'), 'no viewer passed — every staff row')
})

test('Applications: opens on All; a stage changes only on the Manager’s own tuitions', () => {
  assert.equal(roleSatisfies('supervisor', SCREEN_ACCESS.applicantForwards), true)
  assert.equal(defaultFilter(MANAGER), 'all')
  assert.equal(mayEditStage(MANAGER, MANAGER.id), true)
  assert.equal(mayEditStage(MANAGER, OTHER), false)
  assert.equal(mayEditStage(MANAGER, null), false)
})

test('Follow-ups: both tabs open; a follow-up changes only in the Manager’s own cities', () => {
  assert.deepEqual(followUpTabsFor('supervisor'), followUpTabsFor('operations'))
  assert.ok(followUpTabsFor('supervisor').length >= 2)
  assert.equal(supervisorMayChangeCity(MANAGER, MANAGER.id), true)
  assert.equal(supervisorMayChangeCity(MANAGER, OTHER), false)
  assert.ok(read('app/api/admin/follow-ups/tutor/route.ts').includes('refuseSupervisorMember'))
})

test('Paid tutors: opens on every staff member’s list', () => {
  assert.equal(roleSatisfies('supervisor', SCREEN_ACCESS.paidTutors), true)
  assert.equal(seesAllStaffLists('supervisor'), true)
  assert.ok(read('app/admin/paid-tutors/page.tsx').includes("seesAllStaffLists(actor.adminRole) ? 'all' : actor.id"))
})

test('Tuitions: every tuition is listed; actions only on the Manager’s own', () => {
  assert.equal(roleSatisfies('supervisor', SCREEN_ACCESS.jobs), true)
  assert.equal(roleSatisfies('supervisor', SCREEN_ACCESS.tuitionPosting), true)
  assert.equal(supervisorMayChangeTuition(MANAGER, MANAGER.id), true)
  assert.equal(supervisorMayChangeTuition(MANAGER, OTHER), false)
  assert.ok(read('app/api/admin/jobs/action/route.ts').includes('refuseSupervisorTuitions'))
})
