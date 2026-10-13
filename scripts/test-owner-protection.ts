// npm run test:ownerprotection — Partner full rights, Owner protected (owner, 13 Oct 2026).
//
// The rules are pure (lib/adminAccessCore, lib/ownerAlertCore); the routes that
// must apply them are checked by reading their source, since a route handler
// needs a live session. Every refusal below is a 403 on the server.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  alwaysNeedsTwoFactor,
  isReadOnlyRole,
  ownerProtection,
  roleSatisfies,
  staffChangeProblem,
  OWNER_ONLY_OWNERSHIP,
  OWNER_PROTECTED,
  PARTNER_PROTECTED,
  SCREEN_ACCESS,
  type AdminRole,
} from '../lib/adminAccessCore'
import { alertBody, changedFields, maskAccount, pakistanTime, shouldAlertOwner } from '../lib/ownerAlertCore'

const NON_OWNERS: AdminRole[] = ['partner', 'admin', 'operations', 'tuitions_staff']
const read = (...p: string[]) => readFileSync(path.join(...p), 'utf8')

test('a Partner may open every screen; two-factor is always required', () => {
  for (const [key, roles] of Object.entries(SCREEN_ACCESS)) assert.equal(roleSatisfies('partner', roles as AdminRole[]), true, key)
  assert.equal(isReadOnlyRole('partner'), false)
  // Two-factor is always required of a Partner, and only of a Partner.
  assert.equal(alwaysNeedsTwoFactor('partner'), true)
  for (const r of ['owner', 'admin', 'operations', 'tuitions_staff'] as AdminRole[]) assert.equal(alwaysNeedsTwoFactor(r), false)
})

test('nobody except the Owner may change the Owner account (edit, pause, suspend, password, email, mobile, 2FA)', () => {
  for (const r of NON_OWNERS) assert.equal(ownerProtection(r, 'owner'), OWNER_PROTECTED, r)
  assert.equal(ownerProtection('owner', 'owner'), null)
  // An ordinary member or another staff member is not protected by this rule.
  for (const target of [null, 'admin', 'operations', 'tuitions_staff', 'partner']) assert.equal(ownerProtection('partner', target), null)
})

test('nobody except the Owner may demote or remove the Owner, or make anyone Owner', () => {
  for (const r of NON_OWNERS) {
    assert.equal(staffChangeProblem(r, 'owner', 'admin'), OWNER_PROTECTED, `${r} demotes the owner`)
    assert.equal(staffChangeProblem(r, 'owner', null), OWNER_PROTECTED, `${r} removes the owner`)
    assert.equal(staffChangeProblem(r, 'admin', 'owner'), OWNER_ONLY_OWNERSHIP, `${r} makes an owner`)
    assert.equal(staffChangeProblem(r, null, 'owner'), OWNER_ONLY_OWNERSHIP, `${r} creates an owner`)
  }
})

test('a Partner cannot demote, remove or reset another Partner; the Owner can', () => {
  assert.equal(staffChangeProblem('partner', 'partner', 'admin'), PARTNER_PROTECTED)
  assert.equal(staffChangeProblem('partner', 'partner', null), PARTNER_PROTECTED)
  assert.equal(staffChangeProblem('partner', 'partner'), PARTNER_PROTECTED)
  assert.equal(staffChangeProblem('owner', 'partner', 'admin'), null)
  assert.equal(staffChangeProblem('owner', 'partner', null), null)
  // A Partner manages every other staff role, up to Partner.
  for (const target of ['admin', 'operations', 'tuitions_staff']) {
    for (const to of ['admin', 'operations', 'tuitions_staff', 'partner']) assert.equal(staffChangeProblem('partner', target, to), null, `${target} → ${to}`)
    assert.equal(staffChangeProblem('partner', target, null), null)
  }
})

test('every route that changes a member account applies the Owner guard (403)', () => {
  const guard = read('lib', 'ownerGuard.ts')
  assert.ok(guard.includes('status: 403'))
  assert.ok(guard.includes('ownerProtection(actor.adminRole'))
  for (const f of [
    ['app', 'api', 'admin', 'members', 'route.ts'],
    ['app', 'api', 'admin', 'tutors', 'edit', 'route.ts'],
    ['app', 'api', 'admin', 'tutors', 'clear-mobile', 'route.ts'],
    ['app', 'api', 'admin', 'users', 'second-role', 'route.ts'],
  ]) {
    assert.ok(read(...f).includes('refuseOwnerTarget('), `${f.join('/')} calls refuseOwnerTarget`)
  }
  // Two-factor reset, role change, removal and a fresh invite all check the staff rule.
  assert.ok(read('app', 'api', 'admin', 'mfa', 'reset', 'route.ts').includes('staffChangeProblem(gate.actor.adminRole, target.admin_role'))
  const team = read('app', 'api', 'admin', 'team', 'route.ts')
  assert.ok(team.includes("body.adminRole === 'owner' && gate.actor.adminRole !== 'owner'"))
  assert.ok(team.includes('staffChangeProblem(actor.adminRole, target.admin_role as string, null)'))
  const staff = read('lib', 'staff.ts')
  assert.equal(staff.split('staffChangeProblem(params.actor.adminRole').length - 1, 2, 'role change and resend invite')
  assert.ok(staff.includes("ASSIGNABLE_ROLES: AdminRole[] = ['admin', 'operations', 'tuitions_staff', 'partner']"), 'owner is never assignable')
  // The moderation helpers already refuse the Owner outright.
  const mod = read('lib', 'moderation.ts')
  assert.ok(mod.includes('The owner account cannot be suspended.'))
  assert.ok(mod.includes('The owner account cannot be banned.'))
  // Deleting accounts stays with the Owner alone.
  assert.ok(read('app', 'api', 'admin', 'cleanup', 'route.ts').includes("gate.actor.adminRole !== 'owner'"))
})

test('the Owner is told when someone else changes bank details, gateway settings or team roles', () => {
  assert.equal(shouldAlertOwner('owner'), false)
  for (const r of NON_OWNERS) assert.equal(shouldAlertOwner(r), true)
  for (const f of [
    ['app', 'api', 'admin', 'payments', 'bank-details', 'route.ts'],
    ['app', 'api', 'admin', 'payments', 'gateways', 'route.ts'],
    ['app', 'api', 'admin', 'team', 'route.ts'],
  ]) {
    assert.ok(read(...f).includes('alertOwner('), `${f.join('/')} alerts the owner`)
  }
  const alerts = read('lib', 'ownerAlerts.ts')
  assert.ok(alerts.includes('notify(') && alerts.includes('deliverEmail('), 'in-app and email')
})

test('an account number or IBAN is only ever shown as its last 4 digits', () => {
  assert.equal(maskAccount('0123 4567 8901 1949'), '•••• 1949')
  assert.equal(maskAccount('PK36 FAYS 0000 0012 3456 7890'), '•••• 7890')
  assert.equal(maskAccount(''), '(empty)')
  const fields = [
    { field: 'bankName', label: 'Bank name' },
    { field: 'accountNumber', label: 'Account number' },
    { field: 'iban', label: 'IBAN' },
    { field: 'accountTitle', label: 'Account title' },
  ]
  const changes = changedFields(
    fields,
    { bankName: 'Faysal Bank', accountNumber: '0001112223334', iban: 'PK36FAYS0000001234567890', accountTitle: 'Tutor Mint' },
    { bankName: 'Meezan Bank', accountNumber: '9998887776665', iban: 'PK36FAYS0000001234567890', accountTitle: 'Tutor Mint' },
  )
  // Only what changed, before → after.
  assert.deepEqual(changes, [
    { label: 'Bank name', before: 'Faysal Bank', after: 'Meezan Bank' },
    { label: 'Account number', before: '•••• 3334', after: '•••• 6665' },
  ])
  const body = alertBody('Rai Mohsin Raza (Partner)', changes, new Date('2026-10-13T09:05:00Z'))
  assert.ok(!body.includes('0001112223334') && !body.includes('9998887776665'), 'no full account number')
  assert.ok(body.includes('Rai Mohsin Raza (Partner)'))
  assert.ok(body.includes('Bank name: Faysal Bank → Meezan Bank'))
  // Pakistan time (UTC+5).
  assert.equal(pakistanTime(new Date('2026-10-13T09:05:00Z')), '13 Oct 2026, 2:05 pm (Pakistan time)')
})

test('the database lets a Partner write again (migration 165)', () => {
  const sql = read('supabase', 'migrations', '165_partner_full_rights.sql')
  assert.ok(sql.includes('create or replace function public.is_admin_writer()'))
  assert.ok(!/admin_role is distinct from 'partner'\s*\n\s*\)\s*\n\$\$;/i.test(sql.split('-- storage')[0]), 'is_admin_writer no longer excludes the Partner')
})
