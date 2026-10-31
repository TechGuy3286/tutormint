// scripts/test-deep-scan.ts — npm run test:deepscan (owner, 31 Oct 2026).
//
// The deep-scan clean-up PR: Bulk import retired, no PayPro / Pay later /
// consent UI, retired templates hidden and never sent, every parent WhatsApp a
// situation message with its link and the staff ref, the Backend Support role
// (allowed and blocked), the receipt approval rule, the daily staff-approval
// list and its undo, the single-Owner lock, and no personal data in new logs.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import {
  OWNER_ONLY_OWNERSHIP,
  OWNER_PROTECTED,
  OWNER_ROLE_FIXED,
  ROLE_LABEL,
  SCREEN_ACCESS,
  adminHomeFor,
  roleBadge,
  roleMayWrite,
  roleSatisfies,
  staffChangeProblem,
  ownerProtection,
  type AdminRole,
} from '../lib/adminAccessCore'
import { NAV_GROUPS } from '../lib/adminNav'
import { composeOffers, RETIRED_TEMPLATE_KEYS, splitRetired } from '../lib/templateRetireCore'
import { PARENT_DEFAULTS, PARENT_TEMPLATE_KEY, fillParentFollowUp } from '../lib/parentFollowUpCore'
import { finishWaText, waSendHref } from '../lib/waLinkCore'
import { staffApprovalsDigest, staffReceiptDecision, type StaffReceiptInput } from '../lib/staffReceiptCore'
import { followUpCounts, forwardSpeed, forwardSpeedLabel } from '../lib/backendSupportKpiCore'
import { mayEditStage } from '../lib/applicationStageCore'
import { mayOpenFollowUpTab } from '../lib/followUpsPageCore'

const read = (p: string) => readFileSync(p, 'utf8')
const BS: AdminRole = 'backend_support'

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p.replace(/\\/g, '/'))
  }
  return out
}

// ── Part B — Bulk import retired ───────────────────────────────────────
test('Bulk import: files gone, redirects in place, nav and access entries removed', () => {
  for (const p of ['app/admin/import/page.tsx', 'app/admin/import/ImportClient.tsx', 'app/api/admin/import/route.ts', 'lib/import.ts']) {
    assert.ok(!existsSync(p), `${p} removed`)
  }
  const cfg = read('next.config.ts')
  for (const src of ['/admin/import', '/admin/import/:path*', '/admin/bulk-import', '/admin/bulk-import/:path*']) {
    assert.ok(cfg.includes(`{ source: '${src}', destination: '/admin', permanent: true }`), `redirect for ${src}`)
  }
  assert.ok(!NAV_GROUPS.some((g) => g.items.some((i) => i.href === '/admin/import' || i.label === 'Bulk import')))
  assert.ok(!('import' in SCREEN_ACCESS))
})

test('Bulk import: imported profiles and the claim flow are kept', () => {
  assert.ok(existsSync('app/(site)/tutor/claim/page.tsx') && existsSync('app/api/tutor/claim/route.ts'))
  assert.match(read('lib/tutorListingStatus.ts'), /unclaimed_import/)
  // No migration of this PR deletes or changes an imported row.
  const m = read('supabase/migrations/215_single_owner_backend_support.sql')
  assert.ok(!/imported|claimed_at|delete from/i.test(m))
})

// ── Part B — no PayPro / AssanPay / Pay later / consent UI ─────────────
test('no Pay later, consent switch or PayPro health on any screen', () => {
  const ui = [...walk('app'), ...walk('components')].filter((p) => !p.includes('/pay/simulator/'))
  for (const p of ui) {
    const s = read(p)
    assert.ok(!/>\s*Pay later\s*</.test(s) && !/Pay later<span/.test(s), `${p} shows Pay later`)
    assert.ok(!/ConsentChip|ConsentBox|HideNumbersSwitch/.test(s), `${p} renders a consent control`)
  }
  for (const p of ['app/admin/settings/privacy/page.tsx', 'app/api/admin/settings/hide-numbers/route.ts', 'app/api/admin/jobs/consent/route.ts', 'app/api/admin/jobs/consent/ask/route.ts', 'components/tutor/CompletePaymentPrompt.tsx']) {
    assert.ok(!existsSync(p), `${p} removed`)
  }
  const gw = read('app/admin/payments/settings/gateways/page.tsx') + read('app/admin/payments/settings/gateways/GatewaysClient.tsx')
  assert.ok(!/AssanPay|PayPro service fee|loadGatewayHealth|PAYPRO_RETIRED_LINE/.test(gw))
  assert.ok(!read('app/admin/payments/settings/page.tsx').includes('PAYPRO_RETIRED_LINE'))
  assert.ok(!NAV_GROUPS.some((g) => g.items.some((i) => i.href === '/admin/settings/privacy')))
  // The PayPro listener, the reconcile cron and the settlement report stay (cut-off 25 Nov 2026).
  for (const p of ['app/paypro/uis/route.ts', 'app/api/cron/paypro-reconcile/route.ts', 'app/admin/finance/paypro/page.tsx', 'components/admin/PayproSettlementCard.tsx']) {
    assert.ok(existsSync(p), `${p} kept`)
  }
  assert.match(read('app/api/admin/payments/gateways/route.ts'), /method: z\.enum\(\['bank_transfer'\]\)/)
})

// ── Part B — retired templates ──────────────────────────────────────────
test('retired templates: hidden behind "Retired (n)", never offered, never sent', () => {
  const tpl = [
    { key: 'job_under_review', retired: true },
    { key: 'cnic_unclear', retired: false },
    { key: 'pf_no_tuition', retired: false },
    { key: 'seeded_tuition_live', retired: false },
  ]
  const { live, retired } = splitRetired(tpl)
  assert.deepEqual(retired.map((t) => t.key), ['job_under_review'])
  assert.equal(live.length, 3)
  assert.equal(composeOffers({ key: 'job_under_review', retired: true }), false)
  assert.equal(composeOffers({ key: 'cnic_unclear' }), true)
  assert.equal(composeOffers({ key: 'pf_no_tuition' }), false, 'parent situation messages are sent from the parent button only')
  assert.equal(composeOffers({ key: 'seeded_tuition_live' }), false)
  const inbox = read('app/admin/inbox/InboxClient.tsx')
  const retiredView = read('components/admin/RetiredTemplates.tsx')
  assert.match(retiredView, /Retired \(\{templates\.length\}\)/)
  assert.match(retiredView, /<details[^>]*data-retired-templates/)
  assert.match(inbox, /<RetiredTemplates templates=\{templates\.filter\(\(t\) => t\.retired\)\} \/>/)
  assert.match(inbox, /templates\.filter\(\(t\) => composeOffers\(t\)/)
  const msg = read('lib/adminMessaging.ts')
  assert.match(msg, /if \(tpl\?\.retired_at\) return \{ ok: false, status: 410, error: RETIRED_SEND_REFUSAL \}/)
  const m = read('supabase/migrations/215_single_owner_backend_support.sql')
  for (const k of RETIRED_TEMPLATE_KEYS) assert.ok(m.includes(`'${k}'`), `${k} retired by the migration`)
  assert.ok(!/delete from public\.admin_message_templates/i.test(m), 'never deleted')
  // No code path sends a retired key.
  const code = [...walk('app'), ...walk('lib'), ...walk('components')].filter((p) => !p.endsWith('templateRetireCore.ts') && !p.endsWith('templateProposals.ts'))
  for (const k of RETIRED_TEMPLATE_KEYS) {
    for (const p of code) {
      const s = read(p)
      if (new RegExp(`templateKey:\\s*'${k}'|\\.eq\\('key', '${k}'\\)`).test(s)) assert.fail(`${p} sends retired template ${k}`)
    }
  }
})

// ── Part C — parent WhatsApp, situation-based everywhere ────────────────
const SITUATIONS = ['no_tuition', 'no_applicants', 'waiting_forward', 'email_unconfirmed', 'expired', 'hired'] as const

test('every parent situation has its template, a TutorMint link and the staff ref', () => {
  for (const s of SITUATIONS) {
    const key = PARENT_TEMPLATE_KEY[s]
    assert.ok(key && key.startsWith('pf_'), s)
    const text = fillParentFollowUp(PARENT_DEFAULTS[key], {
      firstName: 'Ayesha',
      tuitionTitle: 'Home Tutor for Grade 5 in DHA, Lahore',
      tuitionLink: 'https://www.tutormint.org/tuitions/lahore/home-tutor-abc123',
      postLink: 'https://www.tutormint.org/post-tuition',
      tutorName: 'Ali Raza',
      reviewLink: 'https://www.tutormint.org/review?application=x',
      tutorLinks: ['https://www.tutormint.org/tutor/ali-raza'],
      signinLink: 'https://www.tutormint.org/login',
      repostLink: 'https://www.tutormint.org/tuitions/lahore/home-tutor-abc123',
      supportWhatsapp: '0321 5872222',
    })
    const finished = finishWaText(text, 'AQSA')
    assert.match(finished, /https:\/\/www\.tutormint\.org\/[^\s]*ref=AQSA/, `${key} carries a link with the ref`)
    assert.ok(!/dashboard/.test(finished), `${key} never links a dashboard`)
    assert.ok(!/finding a tutor\? Reply here|Do you need any help finding a tutor/i.test(finished))
    const href = waSendHref('923001234567', finished, 'AQSA')
    assert.ok(href && href.startsWith('https://api.whatsapp.com/send?phone=923001234567&text='))
  }
})

// Every staff file that builds a WhatsApp link is declared here with what it
// sends. A NEW file fails the test until it is reviewed: a parent WhatsApp must
// use the situation message (sendParentMessage) or be one of the declared
// message-specific sends below.
const WA_REGISTRY: Record<string, 'parent-situation' | 'parent-specific' | 'not-parent' | 'builder'> = {
  'lib/waLinkCore.ts': 'builder',
  'lib/supportContacts.ts': 'builder',
  'lib/parentWhatsApp.ts': 'parent-situation', // THE parent builder: pf_* by situation, link + ref
  'components/admin/AdminWhatsAppLink.tsx': 'parent-situation', // → /api/admin/whatsapp → sendParentMessage
  'components/admin/WhatsappChatButton.tsx': 'parent-situation', // same route
  'components/admin/OverviewCardGrid.tsx': 'parent-situation', // same route
  'app/admin/users/[id]/MemberActions.tsx': 'parent-situation', // same route
  'app/admin/jobs/[id]/page.tsx': 'parent-situation', // same route (parent-posted tuitions)
  'components/admin/SignupRows.tsx': 'parent-situation', // parent rows → AdminWhatsAppLink
  'lib/adminWhatsApp.ts': 'not-parent', // returns nothing for a parent
  'lib/adminWhatsAppCore.ts': 'not-parent', // tutors and staff only
  'app/admin/users/[id]/page.tsx': 'not-parent', // payment follow-up: tutors only
  'lib/mySignupsCore.ts': 'not-parent', // parent rows carry no step text
  'lib/followUpCore.ts': 'not-parent',
  'lib/applicationFollowUps.ts': 'parent-specific', // one application's stage message (app_*)
  'app/admin/applications/ForwardToParents.tsx': 'parent-specific', // the tutors-applied list (applicants_forward)
  'lib/applicantForwardCore.ts': 'parent-specific',
  'lib/adminMessaging.ts': 'parent-specific', // team-posted tuition contact (seeded_tuition_live); Team inbox free text
  'components/admin/ParentDocumentReview.tsx': 'parent-specific', // a document decision with its reason
  'lib/tuitionConsent.ts': 'parent-specific', // consent ask — switched off, no screen
  'lib/applicationWhatsApp.ts': 'not-parent',
  'components/admin/TutorDocumentReview.tsx': 'not-parent',
  'app/admin/overview/todo-unmet/UnmetSearchesClient.tsx': 'not-parent', // hiring post share
  'app/api/admin/follow-ups/status-image/route.ts': 'not-parent',
  'lib/documentsApproved.ts': 'not-parent',
  'lib/documentsApprovedCore.ts': 'not-parent',
  'lib/staffOutreachCore.ts': 'not-parent',
  'lib/profileShareCore.ts': 'not-parent',
  'lib/tutorWhatsapp.ts': 'not-parent',
  'lib/unmetSearchCore.ts': 'not-parent',
  'lib/dailyReportCore.ts': 'not-parent',
  'lib/docLockCore.ts': 'not-parent',
  'lib/errorMessages.ts': 'not-parent',
  'lib/payments/receiptCore.ts': 'not-parent',
}

test('every staff WhatsApp builder is declared; parent sends use the situation message', () => {
  const files = [...walk('app/admin'), ...walk('app/api/admin'), ...walk('components/admin'), ...walk('lib')]
  const pattern = /waSendHref|adminWaLink|whatsappHref\(|followUpWaLink|forwardWaLink|AdminWhatsAppLink|waMeHref|waChatHref|waShareHref|whatsappShareLink/
  for (const f of files) {
    if (!pattern.test(read(f))) continue
    assert.ok(f in WA_REGISTRY, `${f} builds a WhatsApp link and is not declared in WA_REGISTRY — review it: a parent message must be their situation message`)
  }
  const route = read('app/api/admin/whatsapp/route.ts')
  assert.match(route, /sendParentMessage\(memberId, actor\)/)
  assert.match(route, /if \(!r\.ok\) return \{ error: r\.error, status: r\.status \}/, 'never falls back to a generic parent text')
  const pw = read('lib/parentWhatsApp.ts')
  assert.match(pw, /templateKey/)
  assert.match(pw, /finishWaText\(text, refCode\)/)
  assert.match(pw, /senderRefCode\(actor\.id\)/)
  assert.match(read('lib/adminWhatsApp.ts'), /if \(p\.role === 'parent' \|\| p\.role === 'academy'\) return \{ href: null, type: null \}/)
  assert.match(read('lib/mySignupsCore.ts'), /const text = f\.role === 'parent' \? null/)
  assert.match(read('app/admin/users/[id]/page.tsx'), /const wa = isTutor && paymentNeedsFollowUp/)
  // No generic or old parent text anywhere in code.
  for (const f of [...walk('app'), ...walk('lib'), ...walk('components')]) {
    assert.ok(!/Do you need any help finding a tutor|parentHelpMessage|PARENT_HELP_LINK/.test(read(f)), f)
  }
})

// ── Part D — Backend Support ───────────────────────────────────────────
test('Backend Support: allowed screens and actions', () => {
  assert.equal(ROLE_LABEL[BS], 'Backend Support')
  assert.equal(roleBadge(BS), 'Backend Support')
  assert.equal(adminHomeFor(BS), '/admin/follow-ups')
  for (const k of ['unpaidSignups', 'signups', 'applicantForwards', 'paidTutors', 'inbox', 'usersView', 'memberActivity', 'memberContactReveal', 'receiptCheck', 'payments', 'backendSupportKpi'] as const) {
    assert.ok(roleSatisfies(BS, SCREEN_ACCESS[k]), `opens ${k}`)
    assert.ok(roleMayWrite(BS, SCREEN_ACCESS[k]), `works ${k}`)
  }
  assert.ok(mayEditStage({ id: 'bs', adminRole: BS }, 'someone-else'), 'changes any application stage')
  assert.ok(mayOpenFollowUpTab(BS, 'tutors') && mayOpenFollowUpTab(BS, 'parents'))
  const nav = NAV_GROUPS.flatMap((g) => g.items).filter((i) => !i.screen || roleSatisfies(BS, SCREEN_ACCESS[i.screen as keyof typeof SCREEN_ACCESS] ?? []))
  const labels = nav.map((i) => i.label)
  for (const l of ['Follow-ups', 'Applications', 'Paid tutors', 'Team inbox', 'People', 'Payments']) assert.ok(labels.includes(l), l)
  for (const l of ['Finance', 'Payment gateways', 'Post a tuition', 'Team', 'Plans', 'Audit', 'Overview', 'Subjects', 'SMS']) assert.ok(!labels.includes(l), `no ${l}`)
})

test('Backend Support: blocked actions', () => {
  for (const k of ['finance', 'revenue', 'paymentAmounts', 'paymentGateways', 'paymentsSwitches', 'plans', 'plansMutate', 'jobsPost', 'jobsMutate', 'memberMerge', 'convertAccount', 'contactWithdraw', 'team', 'users', 'tutorEdit', 'cnicRead', 'subjectsCore', 'notificationSettings', 'templateReview', 'supportNumber', 'secondRole', 'orphans', 'overview', 'audit', 'documentUnlock', 'documentRotate', 'cityOwners', 'cleanup'] as const) {
    assert.ok(!roleMayWrite(BS, SCREEN_ACCESS[k]), `cannot change ${k}`)
  }
  for (const k of ['finance', 'revenue', 'paymentAmounts', 'paymentGateways', 'team', 'audit'] as const) assert.ok(!roleSatisfies(BS, SCREEN_ACCESS[k]), `cannot open ${k}`)
  assert.ok(!mayOpenFollowUpTab(BS, 'orphans'))
  // Member actions (warn, suspend, ban, mobile) stay on `users`, which Backend Support cannot write.
  assert.match(read('app/api/admin/members/route.ts'), /checkAdminRole\(\.\.\.SCREEN_ACCESS\.users\)/)
  assert.match(read('app/admin/users/[id]/page.tsx'), /canModerate=\{roleMayWrite\(actor\.adminRole, SCREEN_ACCESS\.users\)\}/)
  // Templates are edited by owner/admin only; CNIC reveal is the Owner's.
  assert.match(read('app/api/admin/inbox/route.ts'), /roleMayWrite\(gate\.actor\.adminRole, \['admin'\]\)/)
  // A Backend Support token reads no finance rows (migration 215, restrictive policy).
  const m = read('supabase/migrations/215_single_owner_backend_support.sql')
  assert.match(m, /backend_support_no_finance/)
  assert.match(m, /backend_support_no_bank_settings/)
  assert.match(m, /admin_role is distinct from 'backend_support'/)
})

// ── Part D — the receipt approval rule ─────────────────────────────────
const NOW = Date.parse('2026-10-31T10:00:00Z')
const base: StaffReceiptInput = {
  payment: { status: 'pending', provider: 'manual', planCode: 'verified', createdAt: '2026-10-31T08:00:00Z', memberId: 'm1', memberName: 'Muhammad Ali Raza' },
  credits: [{ id: 'c1', date: '2026-10-31', time: '13:30', amountPkr: 200, senderName: 'ALI RAZA', isPaypro: false }],
  range: { min: 199, max: 210 },
  creditedToActor: false,
  alreadyPaid: false,
  refundOpen: false,
}
void NOW

test('receipt rule: allowed when one unlinked credit matches range, 48 hours and name', () => {
  assert.deepEqual(staffReceiptDecision(base), { ok: true, creditId: 'c1' })
})

test('receipt rule: every other case stays with the Owner', () => {
  const r = (patch: Partial<StaffReceiptInput>, p?: Partial<StaffReceiptInput['payment']>) =>
    staffReceiptDecision({ ...base, ...patch, payment: { ...base.payment, ...(p ?? {}) } })
  const reason = (d: ReturnType<typeof staffReceiptDecision>) => (d.ok ? 'ok' : d.reason)
  assert.equal(reason(r({ credits: [] })), 'no_credit')
  assert.equal(reason(r({ credits: [{ ...base.credits[0], senderName: 'Sara Khan' }] })), 'name_mismatch')
  assert.equal(reason(r({ credits: [{ ...base.credits[0], amountPkr: 100 }] })), 'partial')
  assert.equal(reason(r({ credits: [base.credits[0], { ...base.credits[0], id: 'c2' }] })), 'ambiguous')
  assert.equal(reason(r({ credits: [{ ...base.credits[0], date: '2026-11-03' }] })), 'no_credit', 'outside 48 hours')
  assert.equal(reason(r({ credits: [{ ...base.credits[0], isPaypro: true }] })), 'no_credit', 'a PayPro payout never counts')
  assert.equal(reason(r({ alreadyPaid: true })), 'already_paid')
  assert.equal(reason(r({ refundOpen: true })), 'refund_open')
  assert.equal(reason(r({ creditedToActor: true })), 'own_referral')
  assert.equal(reason(r({}, { planCode: 'premium' })), 'not_fee')
  assert.equal(reason(r({}, { provider: 'paypro' })), 'not_bank_transfer')
  assert.equal(reason(r({}, { status: 'approved' })), 'not_pending')
})

test('receipt rule is applied on the server and logged', () => {
  const route = read('app/api/admin/payments/decide/route.ts')
  assert.match(route, /if \(gate\.actor\.adminRole === 'backend_support'\)/)
  assert.match(route, /Only the Owner can reject a receipt\./)
  assert.match(route, /refuseUnlessOwnerApproval\(gate\.actor, 'approve or reject a bank-transfer receipt'/)
  const lib = read('lib/staffReceipt.ts')
  assert.match(lib, /action: 'payment\.staff_approve'/)
  assert.match(lib, /action: 'payment\.staff_approve_refused'/)
  assert.match(lib, /staff_signup_credits/)
  assert.match(lib, /linkChosenCredit\(/)
})

// ── Part D — the daily list and undo ───────────────────────────────────
test('daily "Approved by staff" bell line and the Owner-only undo', () => {
  const d = staffApprovalsDigest([{ staffName: 'Sana', memberName: 'Ali Raza', ref: 'TM-1' }], '2026-10-30')
  assert.equal(d.title, 'Approved by staff — 1 receipt (2026-10-30)')
  assert.match(d.body, /Ali Raza · TM-1 · by Sana/)
  assert.match(d.body, /undo/)
  const lib = read('lib/staffReceipt.ts')
  assert.match(lib, /status: 'pending', reviewed_by: null, reviewed_at: null/, 'undo removes the revenue entry')
  assert.match(lib, /verified_fee_paid_at: null/, 'undo removes the badge')
  assert.match(lib, /settlement_links'\)\.update\(\{ removed_at: now \}\)/, 'the credit link is soft-removed')
  assert.match(lib, /action: 'payment\.staff_approve_undo'/)
  assert.match(read('app/api/admin/payments/staff-approvals/route.ts'), /refuseUnlessOwnerApproval/)
  assert.match(read('app/api/cron/subscriptions/route.ts'), /notifyStaffApprovalsDaily\(\)/)
})

test('KPI: follow-up windows and forwarding speed', () => {
  const now = Date.parse('2026-10-31T10:00:00Z')
  assert.deepEqual(followUpCounts(['2026-10-31T05:00:00Z', '2026-10-28T05:00:00Z', '2026-10-01T05:00:00Z'], now), { today: 1, last7: 2 })
  const s = forwardSpeed(
    [
      { forwardedAt: '2026-10-30T10:00:00Z', appliedAt: '2026-10-30T01:00:00Z' },
      { forwardedAt: '2026-10-30T10:00:00Z', appliedAt: '2026-10-28T01:00:00Z' },
      { forwardedAt: '2026-10-30T10:00:00Z', appliedAt: null },
    ],
    now,
  )
  assert.deepEqual(s, { forwarded: 2, within24h: 1 })
  assert.equal(forwardSpeedLabel({ forwarded7: 2, forwardedWithin24h: 1 }), '1 of 2 within 24 hours')
})

// ── Part E — the single-Owner lock ──────────────────────────────────────
test('single Owner: nobody grants, changes, transfers or removes the Owner', () => {
  for (const actor of ['owner', 'partner', 'admin', 'supervisor', 'operations', 'tuitions_staff', 'backend_support'] as AdminRole[]) {
    assert.ok(staffChangeProblem(actor, 'admin', 'owner'), `${actor} cannot make someone Owner`)
    assert.ok(staffChangeProblem(actor, 'owner', 'admin'), `${actor} cannot change the Owner's role`)
    assert.ok(staffChangeProblem(actor, 'owner', null), `${actor} cannot remove the Owner`)
    if (actor !== 'owner') assert.equal(ownerProtection(actor, 'owner'), OWNER_PROTECTED, `${actor} cannot touch the Owner account`)
  }
  assert.equal(staffChangeProblem('owner', 'admin', 'owner'), OWNER_ONLY_OWNERSHIP)
  assert.equal(staffChangeProblem('owner', 'owner', 'admin'), OWNER_ROLE_FIXED)
  assert.equal(staffChangeProblem('owner', 'owner'), null, "the Owner may still reset their own two-factor")
  const team = read('app/api/admin/team/route.ts')
  assert.match(team, /if \(body\.adminRole === 'owner'\) \{/, 'the Owner role is refused for every actor')
  assert.ok(!read('lib/staff.ts').match(/ASSIGNABLE_ROLES: AdminRole\[\] = \[[^\]]*'owner'/))
  const m = read('supabase/migrations/215_single_owner_backend_support.sql')
  assert.match(m, /create unique index if not exists profiles_single_owner/)
  assert.match(m, /before insert or update or delete on public\.profiles/)
  for (const what of ['cannot be deleted', 'another Owner cannot be created', 'cannot be given or transferred', 'cannot be changed or removed', 'cannot be suspended', 'cannot be banned', 'cannot be merged', 'cannot be removed from the team']) {
    assert.ok(m.includes(what), what)
  }
  assert.match(read('CLAUDE.md'), /exactly one Owner/)
})

// ── no secrets or personal data in logs ─────────────────────────────────
test('new code logs no phone, email, CNIC, account number or key', () => {
  const files = ['lib/staffReceipt.ts', 'lib/staffReceiptCore.ts', 'lib/backendSupportKpi.ts', 'lib/backendSupportKpiCore.ts', 'lib/templateRetireCore.ts', 'app/api/admin/payments/receipt-check/route.ts', 'app/api/admin/payments/staff-approvals/route.ts', 'app/api/admin/payments/decide/route.ts', 'app/api/admin/whatsapp/route.ts', 'lib/parentWhatsApp.ts', 'scripts/apply-migration-215.ts', 'scripts/report-inventory-usage.ts']
  for (const f of files) {
    for (const line of read(f).split('\n')) {
      if (/console\.(log|info|warn|error)\(/.test(line)) {
        assert.doesNotMatch(line, /\b(phone\w*|msisdn|whatsapp|mobile|email|cnic\w*|iban|account_number|password|secret|key)\b/i, `${f}: ${line.trim()}`)
      }
    }
  }
  // Audit details of the new actions carry ids and reasons, never contact data.
  for (const m of read('lib/staffReceipt.ts').matchAll(/detail: \{([^}]*)\}/g)) assert.doesNotMatch(m[1], /phone|msisdn|whatsapp|email|iban|account/i)
})
