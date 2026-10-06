/**
 * scripts/test-pr106h2.ts  —  npm run test:pr106h2
 *
 * PR106-H2 restricted "tuitions_staff" role. The access matrix is unit-tested
 * from the pure core (lib/adminAccessCore); the server enforcement (redirects /
 * 403s / self-scope / no-unguarded-route / silent role change) is proven by
 * source scans of the guards that run on every request. No browser/DB/network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { roleSatisfies, adminHomeFor, SCREEN_ACCESS, type AdminRole } from '../lib/adminAccessCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

type Key = keyof typeof SCREEN_ACCESS
const KEYS = Object.keys(SCREEN_ACCESS) as Key[]
const satisfiedKeys = (role: AdminRole) => KEYS.filter((k) => roleSatisfies(role, SCREEN_ACCESS[k])).sort()

// -------------------------------------------- the access matrix (STEP 1) ----
test('tuitions_staff may open ONLY jobs, jobsPost, jobsMutate and staffActivity', () => {
  assert.deepEqual(satisfiedKeys('tuitions_staff'), ['jobs', 'jobsMutate', 'jobsPost', 'staffActivity'])
})

test('every other screen is refused for tuitions_staff', () => {
  const refused: Key[] = [
    'overview', 'tutors', 'parents', 'plans', 'plansMutate', 'payments',
    'paymentsApprove', 'paymentsSettings', 'paymentsSwitches', 'team', 'reports',
    'inbox', 'users', 'orphans', 'signups', 'usersExport', 'audit', 'seo',
    'videoVisibility', 'tutorSlug', 'tutorEdit', 'ads', 'social', 'import',
    'cleanup', 'blog', 'blogPublish', 'blogQueue', 'blogGenerate',
  ]
  for (const k of refused) {
    assert.equal(roleSatisfies('tuitions_staff', SCREEN_ACCESS[k]), false, `tuitions_staff must NOT satisfy ${k}`)
  }
})

test('tuitions_staff can act on tuitions: post (jobsPost), close/reopen (jobsMutate)', () => {
  assert.ok(roleSatisfies('tuitions_staff', SCREEN_ACCESS.jobs))
  assert.ok(roleSatisfies('tuitions_staff', SCREEN_ACCESS.jobsPost))
  assert.ok(roleSatisfies('tuitions_staff', SCREEN_ACCESS.jobsMutate))
})

test('the restriction does not widen operations or admin', () => {
  // operations is unchanged (no tuitions-mutate, no money, no team).
  assert.equal(roleSatisfies('operations', SCREEN_ACCESS.jobsMutate), false)
  assert.equal(roleSatisfies('operations', SCREEN_ACCESS.payments), false)
  assert.equal(roleSatisfies('operations', SCREEN_ACCESS.team), false)
  // admin keeps everything except team; owner keeps everything.
  assert.equal(roleSatisfies('admin', SCREEN_ACCESS.team), false)
  for (const k of KEYS) assert.ok(roleSatisfies('owner', SCREEN_ACCESS[k]), `owner must satisfy ${k}`)
})

test('the role home breaks the redirect loop', () => {
  assert.equal(adminHomeFor('tuitions_staff'), '/admin/jobs') // a screen it CAN open
  assert.equal(adminHomeFor('operations'), '/admin')
  assert.equal(adminHomeFor('admin'), '/admin')
  assert.equal(adminHomeFor('owner'), '/admin')
})

// -------------------------------------------- server enforcement (scans) ----
test('requireAdminRole redirects a refused role to its own home with the denied flag', () => {
  const a = read('lib/adminAuth.ts')
  assert.match(a, /redirect\(`\$\{adminHomeFor\(actor\.adminRole\)\}\?denied=1`\)/, 'refused → role home + ?denied')
  assert.match(a, /checkAdminRole[^]*status: 403/, 'route handlers answer 403, not a redirect')
})

test('Overview figures are gated and the denied notice is shown on both homes', () => {
  const home = read('app/admin/page.tsx')
  assert.match(home, /requireAdminRole\(\.\.\.SCREEN_ACCESS\.overview\)/, 'overview is role-gated (refuses tuitions_staff)')
  assert.match(home, /denied && <AccessDeniedNotice/, 'notice on /admin')
  const jobs = read('app/admin/jobs/page.tsx')
  assert.match(jobs, /denied && <AccessDeniedNotice/, 'notice on /admin/jobs (the role home)')
})

// Superseded (owner, 6 Oct 2026, item 18): Tuitions staff now see the
// TUITION-POSTING activity of every staff member — and nothing else — read on
// the server with the tuition-only action list.
test('Staff activity for tuitions_staff is tuition-posting only, for all staff', () => {
  const list = read('app/admin/staff-activity/page.tsx')
  assert.ok(list.includes("if (actor.adminRole === 'tuitions_staff') {"), 'its own branch')
  assert.ok(list.includes("loadTuitionActivity("), 'the tuition-only loader')
  const lib = read('lib/staffActivity.ts')
  assert.ok(lib.includes(".in('action', [...TUITION_ACTIVITY_ACTIONS])"), 'the server query is bounded to tuition actions')
  const detail = read('app/admin/staff-activity/[id]/page.tsx')
  assert.ok(detail.includes("redirect(`/admin/staff-activity?person="), 'detail never shows the full view')
})

test('no admin route is left without a role check (the one gap is closed)', () => {
  const orphans = read('app/admin/orphans/page.tsx')
  assert.match(orphans, /requireAdminRole\(\.\.\.SCREEN_ACCESS\.signups\)/, 'orphans redirect is now gated')
  // self-service 2FA admits every staff role (was owner-only) so the role’s
  // Two-factor page works.
  for (const f of ['app/api/admin/mfa/backup/route.ts', 'app/api/admin/mfa/backup-codes/route.ts']) {
    assert.match(read(f), /checkAdminRole\('admin', 'operations', 'tuitions_staff'\)/, `${f} admits all staff`)
  }
})

// -------------------------------------------- Team + notification (STEP 2/3) -
test('tuitions_staff is assignable in Team, everywhere the role list is read', () => {
  assert.match(read('lib/staff.ts'), /ASSIGNABLE_ROLES: AdminRole\[\] = \['admin', 'operations', 'tuitions_staff'\]/)
  assert.match(read('app/api/admin/team/route.ts'), /z\.enum\(\['owner', 'admin', 'operations', 'tuitions_staff'\]\)/)
  const client = read('app/admin/team/TeamClient.tsx')
  assert.match(client, /code: 'tuitions_staff', label: 'Tuitions staff'/, 'selectable with a plain label')
  assert.match(client, /'owner' \| 'admin' \| 'operations' \| 'tuitions_staff'/, 'the row type allows it')
})

test('a role change stays SILENT — no email, no in-app notification (STEP 2)', () => {
  const staff = read('lib/staff.ts')
  const fn = staff.slice(staff.indexOf('export async function changeStaffRole'))
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2)
  assert.ok(!/deliverEmail\(/.test(body), 'changeStaffRole sends no email')
  assert.ok(!/\bnotify\(/.test(body), 'changeStaffRole fires no in-app notification')
  assert.match(body, /logAdminAction\([^]*staff\.role_change/, 'it is still audited (one entry)')
})

test('the migration lets the DB store the new role', () => {
  const m = read('supabase/migrations/100_tuitions_staff_role.sql')
  assert.match(m, /array\['owner', 'admin', 'operations', 'tuitions_staff'\]/, 'CHECK widened')
  assert.match(m, /drop constraint if exists profiles_admin_role_check/, 'drops the old constraint first')
})

test('the Overview nav item is gated so tuitions_staff never sees it', () => {
  assert.match(read('lib/adminNav.ts'), /label: 'Overview', icon: 'gauge', screen: 'overview'/)
})
