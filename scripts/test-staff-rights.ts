/**
 * scripts/test-staff-rights.ts — staff rights clean-up for Backend Support and
 * the Project Manager (owner, 15 Nov 2026), on INVENTED data only (nothing is
 * read from or written to a database):
 *   1. per role (Owner, Project Manager, Backend Support), which member-page
 *      actions show, and that the hidden ones are refused on the server;
 *   2. both roles see the People → Tutors pipeline, and their follow-ups are
 *      logged under their own account;
 *   3. the full-size photo view opens for reviewers, never on public pages;
 *   4. the Project Manager approves documents and bank-matched receipts, and an
 *      approval with no matching bank credit is refused;
 *   5. no "Selfie checked" on People cards (still on the member page);
 *   6. "Tried to pay": the chip, its count and sort, and the grouped
 *      "Started, not completed" line;
 *   7. Backend Support sees no rupees.
 *
 *   npm run test:staffrights
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  canApprove,
  canModerateAccounts,
  partnerEditsPath,
  roleMayWrite,
  roleSatisfies,
  SCREEN_ACCESS,
  PARTNER_ROLE_OPTION,
  type AdminRole,
} from '../lib/adminAccessCore'
import { memberActionAllowed, memberPageActions, OWNER_ONLY_MEMBER_ACTIONS, EDIT_LABEL_OWNER, EDIT_LABEL_STAFF, type MemberAction } from '../lib/memberActionsCore'
import { PEOPLE_TAB_SCREENS } from '../lib/peopleDirectoryCore'
import { docDecider, staffDocRefusal } from '../lib/docDecisionCore'
import { isStaffReceiptApprover, staffReceiptDecision } from '../lib/staffReceiptCore'
import { isDocumentStaff } from '../lib/documentAccess'
import { overviewKeysWithoutMoney } from '../lib/overviewMoneyCore'
import { groupPaymentLines, attemptsLine, triedToPay, TRIED_TO_PAY_LABEL } from '../lib/paymentAttemptsCore'
import { paymentLabel, type PaymentFacts } from '../lib/paymentLabelCore'
import { FU_TRIED, pipelineOrder, type DocState, type PipeContact } from '../lib/tutorPipelineCore'
import { pipeCardFrom, pipeTags, type PipeCard, type PipeDocFacts } from '../lib/tutorPipelineCardCore'
import { cardInView } from '../lib/pipelineRowUpdateCore'
import type { CardDocState } from '../lib/tutorDocQueueCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const DAY = 86_400_000
const T0 = Date.parse('2026-11-16T06:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

const OWNER: AdminRole = 'owner'
const PM: AdminRole = 'partner'
const BS: AdminRole = 'backend_support'

// ----------------------------------------------------------- 1. member page

test('member-page actions per role', () => {
  const owner = memberPageActions(OWNER, 'tutor')
  const pm = memberPageActions(PM, 'tutor')
  const bs = memberPageActions(BS, 'tutor')

  // Message, WhatsApp, Call: everyone who opens member pages.
  for (const a of [owner, pm, bs]) assert.equal(a.contact, true)
  // Warn: all three.
  for (const a of [owner, pm, bs]) assert.equal(a.warn, true)
  // Verify a mobile manually: all three (routine support).
  for (const a of [owner, pm, bs]) assert.equal(a.verifyMobile, true)
  // Edit name, documents and subjects: all three; the mobile and CNIC number: Owner only.
  for (const a of [owner, pm, bs]) assert.equal(a.editProfile, true)
  assert.equal(owner.editLabel, EDIT_LABEL_OWNER)
  assert.equal(pm.editLabel, EDIT_LABEL_STAFF)
  assert.equal(bs.editLabel, 'Edit name, documents and subjects')
  assert.equal(owner.editMobileAndCnic, true)
  assert.equal(pm.editMobileAndCnic, false)
  assert.equal(bs.editMobileAndCnic, false)
  // Suspend / ban / lift a ban / change a mobile / plans: Owner only.
  assert.equal(owner.suspendBan, true)
  for (const a of [pm, bs]) {
    assert.equal(a.suspendBan, false)
    assert.equal(a.changeMobile, false)
    assert.equal(a.grantPlans, false)
  }
  // Create parent account: Backend Support may, for a tutor (a parent account only).
  assert.equal(bs.createSecondRole('parent'), true)
  assert.equal(bs.createSecondRole('tutor'), false)
  assert.equal(owner.createSecondRole('tutor'), true)
  // A parent page: Backend Support edits the name too.
  assert.equal(memberPageActions(BS, 'parent').editProfile, true)
  // Tuitions staff never get these.
  const ts = memberPageActions('tuitions_staff', 'tutor')
  assert.equal(ts.warn, false)
  assert.equal(ts.editProfile, false)
})

test('the members route accepts and refuses per role', () => {
  const all: MemberAction[] = ['warn', 'suspend', 'unsuspend', 'ban', 'unban', 'verify-mobile', 'change-mobile']
  for (const action of all) assert.equal(memberActionAllowed(OWNER, action), true, `owner ${action}`)
  for (const role of [PM, BS, 'admin', 'operations', 'supervisor'] as AdminRole[]) {
    assert.equal(memberActionAllowed(role, 'warn'), true, `${role} warn`)
    assert.equal(memberActionAllowed(role, 'verify-mobile'), true, `${role} verify-mobile`)
    for (const action of OWNER_ONLY_MEMBER_ACTIONS) assert.equal(memberActionAllowed(role, action), false, `${role} ${action}`)
  }
  assert.equal(canModerateAccounts(PM), false)
  assert.equal(canModerateAccounts(BS), false)
  assert.equal(canModerateAccounts(OWNER), true)
})

test('hidden actions are refused on the server, with the Owner alert', () => {
  const members = read('app/api/admin/members/route.ts')
  assert.match(members, /refuseUnlessOwnerModeration\(actor/)
  assert.match(members, /memberActionAllowed\(actor\.adminRole/)
  // Owner-only refusals happen before any write (above the change-mobile branch).
  assert.ok(members.indexOf('refuseUnlessOwnerModeration(actor') < members.indexOf("if (action === 'change-mobile')"))
  // Every other suspend / ban path refuses too.
  for (const f of ['app/api/admin/reports/route.ts', 'app/api/admin/flags/route.ts', 'app/api/admin/tutors/moderate/route.ts']) {
    assert.match(read(f), /refuseUnlessOwnerModeration\(/, f)
  }
  // The mobile and the CNIC number on the Edit tab.
  const edit = read('app/api/admin/tutors/edit/route.ts')
  assert.match(edit, /"change a tutor's mobile number"/)
  assert.match(edit, /"edit a tutor's CNIC number"/)
  // The backstop in lib/moderation: suspend, reinstate, ban and lift a ban.
  const mod = read('lib/moderation.ts')
  assert.equal((mod.match(/const refused = notOwner\(params\.actor\)/g) ?? []).length, 4)
  // Plans stay Owner-only on the server.
  assert.deepEqual(SCREEN_ACCESS.plansMutate, [])
  assert.equal(roleMayWrite(PM, SCREEN_ACCESS.plansMutate), false)
  assert.equal(roleMayWrite(BS, SCREEN_ACCESS.plansMutate), false)
  // Backend Support creates a parent account only.
  assert.match(read('app/api/admin/users/second-role/route.ts'), /Backend Support can create a parent account only/)
  // The member page reads the same rules.
  const page = read('app/admin/users/[id]/page.tsx')
  assert.match(page, /memberPageActions\(actor\.adminRole/)
  assert.match(page, /canSuspendBan=\{pageActs\.suspendBan\}/)
  assert.match(page, /canGrantPlans=\{pageActs\.grantPlans\}/)
  // The Edit tab shows the mobile and the CNIC number read-only for staff.
  assert.match(read('app/admin/users/[id]/edit/TutorFieldEditor.tsx'), /numberReadOnly=\{!canEditMobileAndCnic\}/)
})

// ------------------------------------------------------- 2. People pipeline

test('Project Manager and Backend Support see the People pipeline', () => {
  for (const role of [OWNER, PM, BS]) {
    assert.ok(roleSatisfies(role, SCREEN_ACCESS.people), `${role} opens People`)
    assert.ok(PEOPLE_TAB_SCREENS.tutors.some((s) => roleSatisfies(role, SCREEN_ACCESS[s])), `${role} Tutors tab`)
    // The card's follow-up buttons and the follow-up route.
    assert.ok(roleSatisfies(role, SCREEN_ACCESS.unpaidSignups), `${role} sees the due actions`)
    assert.ok(roleMayWrite(role, SCREEN_ACCESS.unpaidSignups), `${role} may log a follow-up`)
  }
  // The Project Manager's view-only strip never covers People.
  assert.equal(partnerEditsPath('/admin/users'), true)
  // Export CSV is unchanged: neither had it before.
  assert.equal(roleSatisfies(BS, SCREEN_ACCESS.usersExport), false)
  // Follow-ups are recorded with the signed-in staff member.
  const record = read('lib/tutorPipelineRecord.ts')
  assert.match(record, /staff_id|staffId|actor\.id/)
  assert.match(read('app/api/admin/people/follow-up/route.ts'), /gate\.actor/)
})

// ----------------------------------------------------- 3. full-size photos

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(join(ROOT, dir))) {
    const p = join(dir, n)
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out)
    else if (/\.(tsx?|jsx?)$/.test(n)) out.push(p)
  }
  return out
}

test('the large photo view opens for reviewers, never on public pages', () => {
  for (const role of [OWNER, PM, BS]) assert.ok(roleSatisfies(role, SCREEN_ACCESS.documentView), role)
  assert.equal(roleSatisfies('tuitions_staff', SCREEN_ACCESS.documentView), false)
  const src = read('app/api/admin/profile-photo/source/route.ts')
  assert.match(src, /checkAdminRole\(\.\.\.SCREEN_ACCESS\.documentView\)/)
  assert.match(src, /'Cache-Control': 'private, no-store'/)
  // CNIC and selfie images: every staff role but Tuitions staff (the preview route).
  assert.equal(isDocumentStaff({ role: 'admin', admin_role: 'backend_support' }), true)
  assert.equal(isDocumentStaff({ role: 'admin', admin_role: 'partner' }), true)
  assert.equal(isDocumentStaff({ role: 'admin', admin_role: 'tuitions_staff' }), false)
  assert.equal(isDocumentStaff({ role: 'tutor', admin_role: null }), false)
  // No public page uses the admin viewer or the staff-only photo address.
  for (const f of walk('app/(site)')) {
    const t = read(f)
    assert.ok(!t.includes('/api/admin/profile-photo/source'), f)
    assert.ok(!t.includes('components/admin/DocumentViewer'), f)
  }
})

// ------------------------------------------------------------ 4. approvals

test('the Project Manager decides documents like Backend Support', () => {
  assert.equal(docDecider(PM), 'staff')
  assert.equal(docDecider(BS), 'staff')
  assert.equal(docDecider(OWNER), 'owner')
  assert.equal(docDecider('admin'), null)
  assert.equal(canApprove(PM), false) // the Owner-only path stays the Owner's
  // The same Owner-only cases apply.
  const base = { item: 'cnic' as const, decision: 'approve' as const, status: 'pending' as const, rereview: false, nameFlagged: false, nameMismatch: false, nameChecked: true }
  assert.equal(staffDocRefusal(base), null)
  assert.ok(staffDocRefusal({ ...base, status: 'approved' }))
  assert.ok(staffDocRefusal({ ...base, item: 'address' }))
  // The review routes admit the role, and its decisions are recorded for the Owner's Undo.
  assert.ok(SCREEN_ACCESS.documentDecide.includes(PM))
  assert.match(read('lib/docDecisionGate.ts'), /recordStaffDecision/)
})

test('the Project Manager approves bank-matched receipts; unmatched ones are refused', () => {
  assert.ok(isStaffReceiptApprover(PM))
  assert.ok(isStaffReceiptApprover(BS))
  assert.equal(isStaffReceiptApprover('admin'), false)
  const payment = { status: 'pending', provider: 'manual', planCode: 'verified', createdAt: iso(T0 - 2 * 3600_000), memberId: 'm1', memberName: 'Invented Person' }
  const range = { min: 199, max: 210 }
  const matched = staffReceiptDecision({
    payment,
    credits: [{ id: 'c1', amountPkr: 199, senderName: 'INVENTED PERSON', date: iso(T0).slice(0, 10), time: null, isPaypro: false }],
    range,
    creditedToActor: false,
    alreadyPaid: false,
    refundOpen: false,
  })
  assert.deepEqual(matched, { ok: true, creditId: 'c1' })
  const unmatched = staffReceiptDecision({ payment, credits: [], range, creditedToActor: false, alreadyPaid: false, refundOpen: false })
  assert.equal(unmatched.ok, false)
  const route = read('app/api/admin/payments/decide/route.ts')
  assert.match(route, /isStaffReceiptApprover\(gate\.actor\.adminRole\)/)
  assert.match(route, /Only the Owner can reject a receipt/)
  assert.match(route, /refuseUnlessOwnerApproval\(gate\.actor/)
  assert.match(read('app/admin/payments/page.tsx'), /staffMayApprove=\{isStaffReceiptApprover\(actor\.adminRole\)\}/)
})

test('role descriptions match the real rights', () => {
  const team = read('app/admin/team/TeamClient.tsx')
  assert.ok(team.includes("label: 'Backend Support', blurb: 'paid sign-ups, follow-ups and member support; can post tuitions; can approve documents and bank-matched receipts; no finance'"))
  assert.ok(team.includes("label: 'Project Manager', blurb: 'edits tutors, parents and tuitions; can approve documents and bank-matched receipts; finance view only; two-factor required'"))
  assert.ok(PARTNER_ROLE_OPTION.includes('can approve documents and bank-matched receipts'))
})

// ----------------------------------------------------- 5. Selfie checked

test('no "Selfie checked" on People cards; still on the member page', () => {
  const card = read('components/admin/PipelineActions.tsx')
  assert.ok(!card.includes('SELFIE_CHECKED_LABEL'))
  assert.ok(!card.includes('data-selfie-checked'))
  assert.match(read('components/admin/TutorDocumentReview.tsx'), /SELFIE_CHECKED_LABEL/)
  assert.match(read('components/tutor/TutorHeaderCard.tsx'), /SELFIE_CHECKED_LABEL/)
})

// -------------------------------------------------------- 6. Tried to pay

const fact = (over: Partial<PaymentFacts>): PaymentFacts => ({
  planCode: 'verified',
  amountPkr: 199,
  status: 'pending',
  provider: 'paypro',
  createdAt: iso(T0 - 3 * DAY),
  hasReceipt: false,
  ...over,
})

test('Tried to pay: who counts', () => {
  assert.equal(triedToPay([fact({})], T0), true) // started and left
  assert.equal(triedToPay([fact({ checkoutClosedAt: iso(T0 - DAY), checkoutCloseReason: 'expired' })], T0), true)
  assert.equal(triedToPay([fact({ createdAt: iso(T0 - 10 * 60_000) })], T0), false) // started just now
  assert.equal(triedToPay([fact({}), fact({ status: 'approved' })], T0), false) // paid since
  assert.equal(triedToPay([fact({}), fact({ provider: 'manual', hasReceipt: true })], T0), false) // receipt waiting
  assert.equal(triedToPay([fact({ planCode: 'premium' })], T0), false) // not the fee
  assert.equal(triedToPay([], T0), false)
  assert.equal(TRIED_TO_PAY_LABEL, 'Tried to pay')
})

function cs(s: DocState): CardDocState {
  if (s === 'approved') return { status: 'approved', reason: null, hasUpload: true }
  if (s === 'waiting') return { status: 'pending', reason: null, hasUpload: true }
  return { status: 'none', reason: null, hasUpload: false }
}
const docs = (approvedAt: number): PipeDocFacts => ({
  statuses: { cnic: cs('approved'), profilePic: cs('approved'), selfie: cs('none') },
  oldestUploadAt: iso(T0 - 9 * DAY),
  approvedAt: iso(approvedAt),
})
function card(approvedAt: number, tried: boolean, contacts: PipeContact[] = []): PipeCard {
  return pipeCardFrom({
    name: 'Invented Tutor',
    feePaid: false,
    completion: 90,
    mobileOk: true,
    docs: docs(approvedAt),
    contacts,
    notInterested: false,
    paused: false,
    lastActiveAt: iso(T0 - DAY),
    support: '0300 0000000',
    nowMs: T0,
    triedToPay: tried,
  })
}

test('Tried to pay: the chip tag, the count and the sort', () => {
  const tried = card(T0 - 6 * DAY, true)
  const fresh = card(T0 - 1 * DAY, false)
  assert.equal(tried.stage, 'approved')
  assert.ok(pipeTags(tried).fus.includes(FU_TRIED))
  assert.ok(!pipeTags(fresh).fus.includes(FU_TRIED))
  // It still counts under Not followed up too.
  assert.ok(pipeTags(tried).fus.includes('not'))
  assert.equal(cardInView(tried, { stage: 'approved', fu: FU_TRIED }), true)
  assert.equal(cardInView(fresh, { stage: 'approved', fu: FU_TRIED }), false)
  // The count is the number of cards carrying the tag.
  const list = [tried, fresh, card(T0 - 3 * DAY, true), card(T0 - 2 * DAY, false)]
  assert.equal(list.filter((c) => pipeTags(c).fus.includes(FU_TRIED)).length, 2)
  // Sort: within Not followed up, tried first, then the newest approval.
  const sortable = (c: PipeCard) => ({ c, stage: c.stage, section: c.section, paused: c.paused, lastActiveAt: c.lastActiveAt, approvedAt: c.approvedAt, triedToPay: c.triedToPay, lastContactAt: null })
  const order = pipelineOrder(list.map(sortable), T0).map((x) => x.c)
  assert.deepEqual(order.map((c) => [c.triedToPay, c.approvedAt]), [
    [true, iso(T0 - 3 * DAY)],
    [true, iso(T0 - 6 * DAY)],
    [false, iso(T0 - 1 * DAY)],
    [false, iso(T0 - 2 * DAY)],
  ])
  // Only in Approved, fee pending.
  const waiting = pipeCardFrom({ ...{ name: 'X', feePaid: false, completion: 90, mobileOk: true, contacts: [], notInterested: false, paused: false, lastActiveAt: null, support: null, nowMs: T0 }, docs: { statuses: { cnic: cs('waiting'), profilePic: cs('approved'), selfie: cs('none') }, oldestUploadAt: null }, triedToPay: true })
  assert.equal(waiting.triedToPay, false)
  // The People page offers the chip in that stage's row, and the card shows it.
  assert.match((read('app/admin/users/PeopleTabs.tsx') + read('lib/peopleListQuery.ts')), /stageSel === 'approved' \? \[\{ key: FU_TRIED, label: FU_TRIED_LABEL \}\]/)
  assert.match(read('components/admin/PipelineActions.tsx'), /data-tried-to-pay/)
})

test('member page: unfinished attempts read "started, not completed" and repeats are one line', () => {
  const now = T0
  // Seven attempts on 1 Oct (Pakistan time), none completed.
  const rows = Array.from({ length: 7 }, (_, i) => ({
    id: `p${i}`,
    facts: fact({ createdAt: `2026-10-01T0${i}:10:00Z`, checkoutClosedAt: i % 2 ? '2026-10-03T00:00:00Z' : null, checkoutCloseReason: i % 2 ? 'expired' : null }),
  }))
  const lines = groupPaymentLines([{ id: 'paid', facts: fact({ status: 'approved', createdAt: '2026-10-05T09:00:00Z' }) }, ...rows], now)
  assert.equal(lines.length, 2)
  assert.equal(lines[0].kind, 'one')
  assert.equal(lines[1].kind, 'attempts')
  if (lines[1].kind === 'attempts') assert.equal(attemptsLine(lines[1]), 'Verification Fee: 7 payment attempts on 1 Oct — none completed')
  // A single attempt stays its own line, in plain words.
  const one = groupPaymentLines([rows[0]], now)
  assert.equal(one[0].kind, 'one')
  assert.equal(paymentLabel(rows[1].facts, now, { showAmount: false }), 'Verification Fee — started, not completed')
  assert.ok(!paymentLabel(rows[1].facts, now, { showAmount: false }).includes('expired'))
  assert.match(read('app/admin/users/[id]/page.tsx'), /groupPaymentLines\(paymentRows, nowMs\)/)
})

// -------------------------------------------------------------- 7. rupees

test('Backend Support sees no rupees', () => {
  for (const k of ['paymentAmounts', 'revenue', 'finance'] as const) assert.equal(roleSatisfies(BS, SCREEN_ACCESS[k]), false, k)
  assert.deepEqual(overviewKeysWithoutMoney(['revenue', 'todo-due', 'paid-today'] as never, false), ['paid-today'])
  const payments = read('app/admin/payments/page.tsx')
  // Backend Support is not an Owner approver, so even a waiting receipt has no amount.
  assert.match(payments, /withoutAmounts\(payments\.rows, \{ keepAwaiting: canApprove \}\)/)
  assert.equal(canApprove(BS), false)
  // The member page shows amounts only to paymentAmounts.
  assert.match(read('app/admin/users/[id]/page.tsx'), /showAmounts = roleSatisfies\(actor\.adminRole, SCREEN_ACCESS\.paymentAmounts\)/)
})
