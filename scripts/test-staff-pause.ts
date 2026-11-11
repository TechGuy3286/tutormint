/**
 * scripts/test-staff-pause.ts — staff Pause + clean exit, the unpaid-tutor
 * messaging check, clickable payment names, "Not interested" with a reason
 * (owner, 11 Nov 2026). Pure rules, a server render of the name link, and
 * source scans of the server paths, all on INVENTED data. Nothing touches a
 * database. (The database half — a paused account failing is_admin() and the
 * Owner never being pausable — is proven by scripts/apply-migration-229.ts.)
 *
 *   npm run test:staffpause
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { pauseProblem, resumeProblem, staffAccessOpen, restorable, readHandover, PAUSE_OWNER_ONLY, PAUSE_OWNER_TARGET, PAUSE_SELF, PAUSE_ALREADY, RESUME_NOT_PAUSED } from '../lib/staffPauseCore'
import { isActiveParticipant } from '../lib/staffSignupsCore'
import { roleMayWrite, SCREEN_ACCESS } from '../lib/adminAccessCore'
import { tutorTextToParent, GET_VERIFIED_TO_MESSAGE, DEMO_DECLINE_FIXED } from '../lib/tutorMessagingCore'
import { memberAdminHref } from '../lib/memberLinkCore'
import { financeItems } from '../lib/financeItemsCore'
import { niChip, niMarkProblem, niReturns, NI_REASONS, NI_REASON_REQUIRED } from '../lib/notInterestedCore'
import { pipeTags, type PipeCard } from '../lib/tutorPipelineCardCore'
import MemberNameLink from '../components/admin/MemberNameLink'

const read = (f: string) => readFileSync(f, 'utf8')
const OWNER = { id: 'o-1', adminRole: 'owner' }
const staff = (over: Partial<{ id: string; role: string; adminRole: string; pausedAt: string | null }> = {}) => ({
  id: 's-1',
  role: 'admin',
  adminRole: 'backend_support',
  pausedAt: null as string | null,
  ...over,
})

// ------------------------------------------------------------ 1. Pause ----
test('Pause blocks admin access; Resume restores it', () => {
  assert.equal(staffAccessOpen({ role: 'admin', adminRole: 'operations', pausedAt: null }), true)
  assert.equal(staffAccessOpen({ role: 'admin', adminRole: 'operations', pausedAt: '2026-11-11T09:00:00Z' }), false, 'paused → no access')
  assert.equal(staffAccessOpen({ role: 'parent', adminRole: null, pausedAt: null }), false, 'removed → no access')
  // getAdminActor reads the pause column and refuses a paused account.
  const auth = read('lib/adminAuth.ts')
  assert.match(auth, /select\('role, admin_role, email, is_suspended, staff_paused_at'\)/)
  assert.match(auth, /if \(profile\.staff_paused_at\) return null/)
  // Resume clears every pause column.
  const lib = read('lib/staffPause.ts')
  assert.match(lib, /staff_paused_at: null, staff_paused_by: null, staff_paused_reason: null, staff_pause_handover: null/)
})

test('Pause and Remove both revoke every session and refresh token', () => {
  for (const f of ['lib/staffPause.ts', 'lib/formerStaff.ts']) {
    assert.match(read(f), /rpc\('revoke_user_sessions', \{ uid: userId \}\)/, `${f} signs out every device`)
  }
  const sql = read('supabase/migrations/103_lock_privileged_columns.sql')
  assert.match(sql, /delete from auth\.sessions where user_id = uid/)
  assert.match(sql, /delete from auth\.refresh_tokens where user_id = uid::text/)
  // The route reports it back to the Owner.
  assert.match(read('app/api/admin/team/route.ts'), /sessionsRevoked: result\.sessionsRevoked/)
})

test('only the Owner can Pause, Resume or Remove; the Owner is never paused', () => {
  for (const r of ['admin', 'partner', 'supervisor', 'operations', 'tuitions_staff', 'backend_support']) {
    assert.equal(pauseProblem({ id: 'x', adminRole: r }, staff()), PAUSE_OWNER_ONLY, `${r} cannot pause`)
    assert.equal(resumeProblem({ id: 'x', adminRole: r }, staff({ pausedAt: '2026-11-11T09:00:00Z' })), PAUSE_OWNER_ONLY, `${r} cannot resume`)
    assert.equal(roleMayWrite(r as never, SCREEN_ACCESS.team), false, `${r} cannot write the Team route (remove included)`)
  }
  assert.equal(roleMayWrite('owner', SCREEN_ACCESS.team), true)
  assert.equal(pauseProblem(OWNER, staff()), null)
  assert.equal(pauseProblem(OWNER, staff({ adminRole: 'owner', id: 'o-2' })), PAUSE_OWNER_TARGET)
  assert.equal(pauseProblem(OWNER, staff({ id: OWNER.id })), PAUSE_SELF)
  assert.equal(pauseProblem(OWNER, staff({ pausedAt: '2026-11-11T09:00:00Z' })), PAUSE_ALREADY)
  assert.equal(resumeProblem(OWNER, staff()), RESUME_NOT_PAUSED)
  assert.equal(resumeProblem(OWNER, staff({ pausedAt: '2026-11-11T09:00:00Z' })), null)
  assert.match(read('supabase/migrations/229_staff_pause_not_interested_reason.sql'), /The Owner account cannot be paused/)
})

test('a paused or removed staff referral credits Admin', () => {
  assert.equal(isActiveParticipant({ role: 'admin', adminRole: 'operations', suspended: false }), true)
  assert.equal(isActiveParticipant({ role: 'admin', adminRole: 'operations', suspended: true }), false, 'paused is passed as suspended')
  assert.equal(isActiveParticipant({ role: 'parent', adminRole: null }), false, 'removed')
  const s = read('lib/staffSignups.ts')
  assert.ok((s.match(/staff_paused_at/g) ?? []).length >= 8, 'every participant check reads the pause')
  assert.match(s, /link\?\.deactivated_at \|\| !isActiveParticipant/, 'a switched-off link never credits staff')
  // Pause switches the link off; Resume switches on only the link the pause switched off.
  const p = read('lib/staffPause.ts')
  assert.match(p, /update\(\{ deactivated_at: now \}\)\.eq\('staff_id', userId\)\.is\('deactivated_at', null\)/)
  assert.match(p, /update\(\{ deactivated_at: null \}\)\.eq\('staff_id', userId\)\.eq\('deactivated_at', pausedAt\)/)
})

test('their follow-ups move to the Owner; Resume gives back only untouched ones', () => {
  const h = readHandover({
    at: '2026-11-11T09:00:00.000Z',
    ownerId: 'o-1',
    cities: ['Lahore', 'Multan'],
    jobs: [
      { jobId: 'j1', source: 'poster' },
      { jobId: 'j2', source: 'city' },
      { jobId: 'j3', source: null },
    ],
  })!
  assert.ok(h)
  const back = restorable(h, {
    cities: [
      { city: 'Lahore', staffId: null, updatedAt: '2026-11-11T09:00:00Z' },
      { city: 'Multan', staffId: 's-9', updatedAt: '2026-11-12T09:00:00Z' }, // given to someone else since
    ],
    jobs: [
      { jobId: 'j1', staffId: 'o-1', assignedAt: '2026-11-11T09:00:00Z' },
      { jobId: 'j2', staffId: 'o-1', assignedAt: '2026-11-12T10:00:00Z' }, // re-assigned since
      { jobId: 'j3', staffId: 's-9', assignedAt: '2026-11-11T09:00:00Z' },
    ],
  })
  assert.deepEqual(back.cities, ['Lahore'])
  assert.deepEqual(back.jobs, [{ jobId: 'j1', source: 'poster' }])
  assert.equal(readHandover(null), null)
  // Pause AND Remove hand over through the one helper, to the site Owner.
  const ho = read('lib/staffHandover.ts')
  assert.match(ho, /update\(\{ staff_id: ownerId, source: 'reassigned'/)
  assert.match(ho, /from\('city_owners'\)\.update\(\{ staff_id: null/)
  assert.match(read('lib/staffPause.ts'), /handOverToOwner\(admin, actor, userId, now, 'staff paused'\)/)
  assert.match(read('lib/formerStaff.ts'), /handOverToOwner\(admin, actor, userId, now, 'former staff'\)/)
  assert.doesNotMatch(read('lib/formerStaff.ts'), /cityOwnerFor/, 'no longer moved to each city owner')
})

// ------------------------------------------------------- 2. Messaging -----
test('an unpaid tutor cannot message a parent server-side; support stays open', () => {
  assert.equal(GET_VERIFIED_TO_MESSAGE, 'Get verified to message parents.')
  const m = read('lib/messaging.ts')
  // Starting a conversation and replying both refuse with the Verify gate.
  assert.match(m, /error: GET_VERIFIED_TO_MESSAGE,\n\s+gate: await buildGate\('tutor_verify', ent\)/)
  assert.match(m, /if \(!tp\?\.verified_fee_paid_at\) \{[\s\S]{0,400}error: GET_VERIFIED_TO_MESSAGE, gate: \(await buildGate\('tutor_verify', vEnt\)\)/)
  // Applying (the note to the parent) is fee-gated.
  assert.match(read('lib/applications.ts'), /if \(ent\.audience === 'tutor' && !ent\.verified\)/)
  // A demo-decline reason from an unpaid tutor is never delivered.
  assert.equal(tutorTextToParent({ verified: false, abusive: false }), false)
  assert.equal(tutorTextToParent({ verified: true, abusive: false }), true)
  const d = read('app/api/demo/respond/route.ts')
  assert.match(d, /const shown = delivered \? reason : DEMO_DECLINE_FIXED/)
  assert.match(d, /body: shown,/)
  assert.ok(DEMO_DECLINE_FIXED.length > 0)
  // The TutorMint Team channel has no fee gate.
  const team = read('app/api/account/messages/route.ts')
  assert.doesNotMatch(team, /verified_fee_paid_at|tutor_verify|GET_VERIFIED_TO_MESSAGE/)
})

test('flagged content is never delivered', () => {
  assert.equal(tutorTextToParent({ verified: true, abusive: true }), false)
  // Messages: written withheld, before any notification.
  const m = read('lib/messaging.ts')
  assert.match(m, /withheld_at: withheld \? nowIso : null/)
  // Application note: refused before quota, flagged.
  const a = read('lib/applications.ts')
  assert.match(a, /if \(note && detectAbuse\(note\)\.length > 0\) \{[\s\S]{0,300}return \{ ok: false, status: 400, error: WITHHELD_CONTENT_LINE \}/)
  assert.ok(a.indexOf('detectAbuse(note)') < a.indexOf('spendTuitionPool('), 'checked before any quota is spent')
  // Demo decline reason: flagged and replaced.
  assert.match(read('app/api/demo/respond/route.ts'), /flagIfAbusive\(\{ source: 'message'[^\n]*withheld: true \}\)/)
  // Profile text: refused before save.
  assert.match(read('app/api/profile/save/route.ts'), /return NextResponse\.json\(\{ error: WITHHELD_CONTENT_LINE \}, \{ status: 400 \}\)/)
})

// ---------------------------------------------------- 3. Payment names ----
test('payment names link to the member page', () => {
  const id = '0b5d6c0e-1111-4222-8333-944455556666'
  assert.equal(memberAdminHref(id), `/admin/users/${id}`)
  assert.equal(memberAdminHref(null), null, 'a deleted account stays plain text')
  assert.equal(memberAdminHref('not-a-uuid'), null)
  const html = renderToStaticMarkup(React.createElement(MemberNameLink, { id, name: 'Zara Imtiaz' }))
  assert.match(html, new RegExp(`href="/admin/users/${id}"`))
  assert.match(html, />Zara Imtiaz</)
  const plain = renderToStaticMarkup(React.createElement(MemberNameLink, { id: null, name: 'Deleted member' }))
  assert.doesNotMatch(plain, /href=/)
  // Payments queue, subscriptions, staff approvals, Finance.
  const q = read('app/admin/payments/PaymentQueue.tsx')
  assert.match(q, /<MemberNameLink id=\{p\.userId\} name=\{p\.name\} \/>/)
  assert.ok((q.match(/<MemberNameLink id=\{s\.userId\}/g) ?? []).length === 2, 'subscriptions: phone cards and desktop table')
  assert.match(read('app/admin/payments/staff-approved/page.tsx'), /<MemberNameLink id=\{r\.memberId\}/)
  assert.match(read('app/admin/finance/settlement/SettlementsBoard.tsx'), /<MemberLine m=\{it\.member\} \/>/)
  // Finance items carry the member (invented data).
  const items = financeItems(
    { credits: [], orders: [], receipts: [{ id: 'r1', ref: 'TM-TEST-1', amountPkr: 199, approvedDay: '2026-11-10', transactionId: null, payerName: 'Zara Imtiaz', memberId: id, state: 'matched', creditId: 'c1', ageDays: 0, overdue: false }], attention: [] } as never,
    [],
    {},
    [{ id: 'rd1', memberId: id, memberName: 'Omar Farooq', paymentRef: 'TM-TEST-2', amountPkr: 200, createdAt: '2026-11-10T09:00:00Z' }],
  )
  assert.deepEqual(items.find((i) => i.kind === 'receipt')?.member, { id, name: 'Zara Imtiaz' })
  assert.deepEqual(items.find((i) => i.kind === 'refund_due')?.member, { id, name: 'Omar Farooq' })
})

// --------------------------------------------------- 5. Not interested ----
test('"Not interested" requires a reason', () => {
  assert.equal(niMarkProblem(null, null), NI_REASON_REQUIRED)
  assert.equal(niMarkProblem('', 'note'), NI_REASON_REQUIRED)
  assert.equal(niMarkProblem('made_up', null), NI_REASON_REQUIRED)
  assert.equal(niMarkProblem('other', ''), 'Add a short note for "Other".')
  for (const r of NI_REASONS.filter((x) => x !== 'other')) assert.equal(niMarkProblem(r, null), null, r)
  assert.equal(niMarkProblem('other', 'moving abroad'), null)
  assert.equal(niChip({ reason: 'wont_pay', at: '2026-11-11T09:00:00Z' }, () => '11 Nov 2026'), "Not interested · Doesn't want to pay · 11 Nov 2026")
  assert.equal(niChip({ reason: null, at: '2026-11-11T09:00:00Z' }, () => '11 Nov 2026'), 'Not interested · 11 Nov 2026')
  // The server enforces it (markNotInterested), the migration CHECKs the value.
  assert.match(read('lib/followUpDismissals.ts'), /const problem = niMarkProblem\(reason, note\)\n\s+if \(problem\) return \{ ok: false, status: 400, error: problem \}/)
  assert.match(read('supabase/migrations/229_staff_pause_not_interested_reason.sql'), /quick_reason in \('wont_pay', 'not_teaching', 'found_work', 'wrong_number', 'other'\)/)
})

test('a marked member leaves the pending lists, and returns on upload or payment', () => {
  const card = { stage: 'approved', section: 'not', notInterested: true, informed: false, plan: null } as unknown as PipeCard
  assert.equal(pipeTags(card).ni, true, 'stored with ni = true, which every pending list and badge filters out')
  // Returns on its own — only a step taken after the mark.
  const mark = { at: '2026-11-11T09:00:00Z' }
  assert.equal(niReturns(mark, 'document_uploaded', '2026-11-12T09:00:00Z'), true)
  assert.equal(niReturns(mark, 'payment_approved', '2026-11-12T09:00:00Z'), true)
  assert.equal(niReturns(mark, 'login', '2026-11-12T09:00:00Z'), false)
  assert.equal(niReturns(mark, 'document_uploaded', '2026-11-10T09:00:00Z'), false)
  assert.equal(niReturns(null, 'document_uploaded', '2026-11-12T09:00:00Z'), false)
  for (const [f, ev] of [
    ['app/api/documents/upload/route.ts', 'document_uploaded'],
    ['app/api/profile/photo/route.ts', 'photo_uploaded'],
    ['app/api/payments/receipt/route.ts', 'receipt_sent'],
  ] as const) {
    assert.match(read(f), new RegExp(`returnFromNotInterested\\(user\\.id, '${ev}'\\)`), f)
  }
  assert.equal((read('lib/payments/activate.ts').match(/returnFromNotInterested\(userId, 'payment_approved'\)/g) ?? []).length, 2, 'the fee and plan branches')
  // The mark stays in history: returning stamps undone, never deletes.
  const fd = read('lib/followUpDismissals.ts')
  assert.match(fd, /update\(\{ undone_at: now, undone_by: null, undone_by_name: NI_RETURNED_BY \}\)/)
  assert.doesNotMatch(fd, /\.delete\(\)/)
})
