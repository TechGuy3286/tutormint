// npm run test:partnerareas — the Partner ("Project Manager") edits tutors,
// parents and tuitions; everything else is view only (owner, 13 Oct 2026).
//
// A route handler needs a live session, so the rule is proved in two halves:
//   1. the pure rule — roleMayWrite() and the checkAdminRole source that turns a
//      "may not write" into a 403 for every method except GET/HEAD;
//   2. EVERY /api/admin write route is listed below with what a Partner may do
//      there, and the list is checked against the access list the route itself
//      passes to checkAdminRole. A new route that is not listed fails the test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import {
  PARTNER_ROLE_OPTION,
  PROJECT_MANAGER,
  ROLE_LABEL,
  SCREEN_ACCESS,
  partnerEditsPath,
  roleBadge,
  roleMayWrite,
  roleSatisfies,
  roleWord,
  type AdminRole,
} from '../lib/adminAccessCore'

const read = (...p: string[]) => readFileSync(path.join(...p), 'utf8')
type Key = keyof typeof SCREEN_ACCESS

// What a Partner may CHANGE, by SCREEN_ACCESS key.
const EDIT: Key[] = [
  'tutors', 'parents', 'users', 'signups', 'orphans', 'unpaidSignups', 'featuredWhatsapp',
  'jobs', 'jobsMutate', 'jobsPost', 'pausedTuitions', 'duplicates', 'duplicatesMerge', 'applicantForwards',
  'inbox', 'reports', 'tuitionPosting', 'tutorEdit', 'tutorSlug', 'videoVisibility', 'documentUnlock', 'documentRotate', 'cnicRead',
]

test('the Partner may open every screen, and change only the tutor, parent and tuition areas', () => {
  for (const [key, roles] of Object.entries(SCREEN_ACCESS) as [Key, AdminRole[]][]) {
    assert.equal(roleSatisfies('partner', roles), true, `opens ${key}`)
    assert.equal(roleMayWrite('partner', roles), EDIT.includes(key), `changes ${key}`)
  }
})

test('every view-only area refuses a Partner write; the Owner is unaffected', () => {
  const VIEW: Key[] = [
    'finance', 'revenue', 'paymentAmounts', 'payments', 'paymentsApprove', 'paymentsRefund', 'paymentsSettings', 'paymentsSwitches',
    'paymentGateways', 'smsHealth', 'emailHealth', 'reconciliation', 'plans', 'plansMutate', 'subjectsCore', 'secondRole', 'team', 'audit', 'seo', 'unmetSearches',
    'ads', 'social', 'import', 'cleanup', 'blog', 'blogPublish', 'blogApprove', 'blogQueue', 'blogGenerate', 'staffActivity', 'signupFunnel', 'usersExport', 'overview',
    'staffSignupsAll', 'staffSignupClaim', 'staffClaimsReview', 'mySignups',
  ]
  for (const key of VIEW) {
    assert.equal(roleMayWrite('partner', SCREEN_ACCESS[key]), false, key)
    assert.equal(roleMayWrite('owner', SCREEN_ACCESS[key]), true, `owner ${key}`)
  }
  // Every key is classified one way or the other.
  assert.deepEqual([...EDIT, ...VIEW].sort(), Object.keys(SCREEN_ACCESS).sort())
  // Nobody else's rights moved: for every other role, writing is opening.
  for (const r of ['owner', 'admin', 'operations', 'tuitions_staff'] as AdminRole[]) {
    for (const roles of Object.values(SCREEN_ACCESS)) assert.equal(roleMayWrite(r, roles), roleSatisfies(r, roles))
  }
})

test('checkAdminRole turns "may not write" into 403 for every method but GET and HEAD', () => {
  const auth = read('lib', 'adminAuth.ts')
  assert.ok(auth.includes('(isReadOnlyRole(actor.adminRole) || !roleMayWrite(actor.adminRole, allowed)) && !opts.self'))
  assert.ok(auth.includes("if (!(await isReadRequest())) return { ok: false, status: 403, error: PARTNER_READ_ONLY }"))
  // The Partner still needs two-factor passed in the session.
  assert.ok(auth.includes('alwaysNeedsTwoFactor(actor.adminRole) && !opts.self'))
})

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

// Every /api/admin route with a write method → what a Partner may do there.
//   edit   the write succeeds (the route's access list names 'partner')
//   view   the write is refused with 403
//   owner  owner only by its own check
//   self   the staff member's own two-factor
const ROUTES: Record<string, 'edit' | 'view' | 'owner' | 'self' | 'mixed'> = {
  'ads': 'view',
  'applicant-forwards/forward': 'edit',
  'applicant-forwards/outcome': 'edit',
  'blog/cover': 'view',
  'blog/generate-cover': 'view',
  'blog/generate': 'view',
  'blog/queue': 'view',
  'blog': 'view',
  'cleanup': 'view',
  'documents/read-cnic': 'edit',
  'documents/rotate': 'edit',
  'documents/unlock': 'edit',
  'flags': 'edit',
  'follow-ups': 'edit',
  // Check payment status on a Started payment card (owner, 20 Oct 2026):
  // checkAdminRole('partner') — the Owner and the Partner only.
  'follow-ups/payment-check': 'edit',
  'import': 'view',
  // Reply (POST) is an edit; editing a template (PUT) is refused inside the route.
  'inbox': 'mixed',
  'jobs/[id]/notify': 'edit',
  'jobs/[id]': 'edit',
  'jobs/action': 'edit',
  'jobs/contact-number': 'edit',
  'jobs/create': 'edit',
  'jobs/paused': 'edit',
  // "Add as new area" while posting is an edit; merging areas is Locations (view).
  'locations/area': 'mixed',
  'locations': 'view',
  // Review added areas (owner, 16 Oct 2026): Owner-only decisions.
  'locations/run-review': 'view',
  // A WhatsApp tap on My sign-ups / Team activity lists only writes the log.
  'my-signups/whatsapp': 'edit',
  'members': 'edit',
  'mfa/backup-codes': 'self',
  'mfa/backup': 'self',
  'mfa/reset': 'view',
  'onboarding-mode': 'view',
  'orphans/create': 'edit',
  'outreach/contact': 'edit',
  'outreach/featured': 'edit',
  'parents/document-review': 'edit',
  'payments/alert-emails': 'view',
  'payments/bank-details': 'view',
  'payments/decide': 'view',
  'payments/gateways': 'view',
  'sms/test': 'view',
  'payments/reconciliation': 'view',
  'payments/refund': 'view',
  'payments/settlement/credits': 'view',
  'payments/settlement/links': 'view',
  'payments/settlement': 'view',
  'payments/switches': 'view',
  'paypro/test-order': 'owner',
  'plans': 'view',
  'profile-photo/crop': 'edit',
  'profile-photo/rotate': 'edit',
  'reauth': 'self',
  'reports': 'edit',
  'social': 'view',
  'staff-signups/claims': 'view',
  // Monthly targets (owner, 16 Oct 2026): Owner only by its own check
  // (refuseUnlessOwnerTargets → 403 + the Owner is alerted).
  'team-activity/targets': 'owner',
  'staff-signups/claims/decide': 'view',
  'taxonomy/core': 'view',
  'team': 'view',
  'tutors/clear-mobile': 'edit',
  'tutors/cnic-reveal': 'edit',
  'tutors/document-review': 'edit',
  'tutors/edit': 'edit',
  'tutors/media': 'edit',
  'tutors/moderate': 'edit',
  'tutors/slug': 'edit',
  'tutors/video-visibility': 'edit',
  'unmet-searches/done': 'view',
  'unmet-searches/search-word': 'view',
  'unmet-searches/subject': 'view',
  'users/second-role': 'view',
}

/** The access lists a route passes to checkAdminRole, resolved to role lists. */
function gates(src: string): AdminRole[][] {
  const out: AdminRole[][] = []
  for (const m of src.matchAll(/checkAdminRole\(([^\n]*)\)/g)) {
    const arg = m[1]
    const keys = [...arg.matchAll(/SCREEN_ACCESS\.(\w+)/g)].map((k) => k[1] as Key)
    if (keys.length > 0) for (const k of keys) out.push(SCREEN_ACCESS[k])
    else out.push([...arg.matchAll(/'(\w+)'/g)].map((r) => r[1] as AdminRole))
  }
  return out
}

test('every admin write route is classified, and its own access list agrees', () => {
  const root = path.join('app', 'api', 'admin')
  const files = walk(root).filter((f) => /route\.tsx?$/.test(f))
  const seen = new Set<string>()
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    if (!/export (async )?function (POST|PUT|PATCH|DELETE)/.test(src)) continue
    const key = path.relative(root, path.dirname(f)).split(path.sep).join('/')
    seen.add(key)
    const want = ROUTES[key]
    assert.ok(want, `classify the new admin write route "${key}" in scripts/test-partner-areas.ts`)
    if (want === 'self' || want === 'owner') continue
    const g = gates(src)
    assert.ok(g.length > 0, `${key} calls checkAdminRole with a readable access list`)
    const anyWrite = g.some((roles) => roleMayWrite('partner', roles))
    const allWrite = g.every((roles) => roleMayWrite('partner', roles))
    if (want === 'edit') assert.ok(anyWrite, `${key}: a Partner write must succeed`)
    if (want === 'view') assert.ok(!anyWrite, `${key}: a Partner write must be refused (403)`)
    if (want === 'mixed') assert.ok(anyWrite, `${key}: the edit half must succeed`)
    void allWrite
  }
  assert.deepEqual([...seen].sort(), Object.keys(ROUTES).sort(), 'the list matches the routes that exist')
})

test('the mixed routes refuse their view-only half inside the route', () => {
  // Team inbox: reply is an edit; editing the shared templates is not.
  const inbox = read('app', 'api', 'admin', 'inbox', 'route.ts')
  assert.ok(inbox.includes("if (!roleMayWrite(gate.actor.adminRole, ['admin']))"))
  assert.equal(roleMayWrite('partner', ['admin']), false)
  // Areas: adding one while posting is allowed; merging is Locations.
  const area = read('app', 'api', 'admin', 'locations', 'area', 'route.ts')
  assert.ok(area.includes("action === 'add' ? SCREEN_ACCESS.jobsPost : SCREEN_ACCESS.seo"))
  assert.ok(area.includes('refuseUnlessOwnerApproval('), 'merges are Owner-only')
  assert.equal(roleMayWrite('partner', SCREEN_ACCESS.seo), false)
  assert.equal(roleMayWrite('partner', SCREEN_ACCESS.jobsPost), true)
  // A Partner may ban AND lift a ban (owner, 14 Oct 2026), verify or change a
  // mobile. An admin may ban but not lift one; operations may do neither.
  const members = read('app', 'api', 'admin', 'members', 'route.ts')
  assert.ok(members.includes("action === 'unban' && !roleMayWrite(actor.adminRole, ['partner'])"))
  assert.equal(roleMayWrite('partner', ['partner']), true)
  assert.equal(roleMayWrite('partner', ['admin', 'partner']), true)
  assert.equal(roleMayWrite('owner', ['partner']), true)
  assert.equal(roleMayWrite('admin', ['partner']), false)
  assert.equal(roleMayWrite('operations', ['partner']), false)
  // The member page shows "Lift ban" by the same rule, and both are audited.
  assert.ok(read('app', 'admin', 'users', '[id]', 'page.tsx').includes("canUnban={roleMayWrite(actor.adminRole, ['partner'])}"))
  const moderation = read('lib', 'moderation.ts')
  assert.ok(moderation.includes("action: 'member.unban'") && moderation.includes("action: 'member.ban'"))
  assert.ok(members.includes("action === 'ban' && !roleMayWrite(actor.adminRole, ['admin', 'partner'])"))
  assert.equal(roleMayWrite('partner', []), false)
  // Owner protection is still applied to every member change.
  assert.ok(members.includes('refuseOwnerTarget('))
})

test('which admin pages show their buttons to a Partner', () => {
  for (const p of ['/admin/tutors', '/admin/tutors/abc', '/admin/parents', '/admin/users', '/admin/users/abc', '/admin/users/unpaid-signups', '/admin/users/featured-whatsapp', '/admin/signups', '/admin/jobs', '/admin/jobs/new', '/admin/jobs/abc/edit', '/admin/jobs/paused', '/admin/jobs/duplicates', '/admin/jobs/applicants', '/admin/inbox', '/admin/reports', '/admin/flags', '/admin/overview/todo-stuck', '/admin/overview/todo-docs', '/admin/security']) {
    assert.equal(partnerEditsPath(p), true, p)
  }
  for (const p of ['/admin', '/admin/finance', '/admin/finance/settlement', '/admin/payments', '/admin/payments/settings/gateways', '/admin/payments/bank-details', '/admin/plans', '/admin/settings/subjects', '/admin/seo/locations', '/admin/seo/landing', '/admin/seo/indexing', '/admin/blog', '/admin/blog/new', '/admin/blog/queue', '/admin/social', '/admin/ads', '/admin/import', '/admin/team', '/admin/audit', '/admin/staff-activity', '/admin/overview/todo-unmet', '/admin/usersx']) {
    assert.equal(partnerEditsPath(p), false, p)
  }
})

test('"Project Manager" is a label only: Owner and Partner both read it; roles are unchanged', () => {
  assert.equal(PROJECT_MANAGER, 'Project Manager')
  assert.equal(roleBadge('owner'), 'Project Manager')
  assert.equal(roleBadge('partner'), 'Project Manager')
  assert.equal(ROLE_LABEL.owner, 'Project Manager')
  assert.equal(ROLE_LABEL.partner, 'Project Manager')
  assert.equal(roleWord('owner'), 'Project Manager')
  assert.equal(roleWord('partner'), 'Project Manager')
  assert.equal(roleWord('operations'), 'Operations')
  assert.equal(roleWord('system'), 'system')
  for (const r of ['admin', 'operations', 'tuitions_staff']) assert.equal(roleBadge(r), 'Admin')
  // Approvals are the Owner's alone (owner, 15 Oct 2026).
  assert.equal(PARTNER_ROLE_OPTION, 'Project Manager — edits tutors, parents and tuitions; approvals are Owner only; everything else view only; two-factor required')
  const team = read('app', 'admin', 'team', 'TeamClient.tsx')
  assert.ok(team.includes("label: 'Project Manager', blurb: 'edits tutors, parents and tuitions; approvals are Owner only; everything else view only; two-factor required'"))
  // Only the Owner, on their own card, sees "(account owner)".
  assert.ok(team.includes("s.isMe && s.adminRole === 'owner' && viewerRole === 'owner'"))
  assert.ok(team.includes('(account owner)'))
  // The stored role names did not change.
  assert.ok(read('lib', 'staff.ts').includes("ASSIGNABLE_ROLES: AdminRole[] = ['admin', 'operations', 'tuitions_staff', 'partner']"))
})

test('the database keeps a Partner out of the view-only tables (migration 170)', () => {
  const sql = read('supabase', 'migrations', '170_partner_edit_areas_one_off_emails.sql')
  assert.ok(sql.includes('create or replace function public.is_admin_full_writer()'))
  assert.ok(sql.includes("p.admin_role is distinct from 'partner'"))
  for (const t of ['profiles', 'tutor_profiles', 'tutor_subjects', 'user_documents', 'children', 'jobs', 'job_subjects', 'applications', 'demo_requests']) {
    assert.ok(sql.includes(`'${t}'`), `${t} stays editable`)
  }
  assert.ok(!/begin;|commit;/i.test(sql), 'the runner owns the transaction')
})
