/**
 * scripts/test-pr106h4.ts  —  npm run test:pr106h4
 *
 * PR106-H4: Verified badge instant on payment (paused on rejection, held paused
 * through re-upload until approval), the activity block, refunds, and the
 * Post-a-tuition draft. Pure logic (badge rule, doc-status mapping, refund math)
 * + source scans of the server guards. No DB/network/browser.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { tutorVerifiedBadgeOk, tutorDocRejected, firstRejectedDoc, type TutorDocs } from '../lib/badgeRule'
import { tutorDocStatusesFromProfile } from '../lib/tutorDocStatus'
import { refundState, refundLabel, resolveRefundAmount } from '../lib/payments/refundCore'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const docs = (over: Partial<Record<'cnic' | 'photo' | 'selfie', Partial<TutorDocs['cnic']>>> = {}): TutorDocs => ({
  cnic: { present: true, rawStatus: 'submitted', reasonPresent: false, ...over.cnic },
  photo: { present: true, rawStatus: 'pending', reasonPresent: false, ...over.photo },
  selfie: { present: true, rawStatus: 'pending', reasonPresent: false, ...over.selfie },
})

// ----------------------------------------------- STEP 1: badge on payment ---
test('badge is on the moment fee is paid and docs submitted — no staff approval', () => {
  assert.equal(tutorVerifiedBadgeOk(true, docs()), true) // all submitted (pending), none rejected
  assert.equal(tutorVerifiedBadgeOk(false, docs()), false) // fee not paid
  // a doc not yet submitted
  assert.equal(tutorVerifiedBadgeOk(true, docs({ selfie: { present: false, rawStatus: 'none' } })), false)
  // approved also counts (an already-approved tutor stays verified)
  assert.equal(tutorVerifiedBadgeOk(true, docs({ cnic: { rawStatus: 'approved' } })), true)
})

// ----------------------------------------------- STEP 2: rejection pauses ---
test('a rejected document pauses the badge and blocks activity', () => {
  const d = docs({ cnic: { rawStatus: 'rejected', reasonPresent: true } })
  assert.equal(tutorVerifiedBadgeOk(true, d), false)
  assert.equal(tutorDocRejected(d), true)
  assert.equal(firstRejectedDoc(d)?.key, 'cnic')
  assert.equal(firstRejectedDoc(d)?.awaitingReview, false) // not re-uploaded yet
})

test('re-upload after rejection keeps the badge paused until approval (reason lingers)', () => {
  // status back to pending but the rejection reason still set → still blocked.
  const reuploaded = docs({ photo: { rawStatus: 'pending', reasonPresent: true } })
  assert.equal(tutorVerifiedBadgeOk(true, reuploaded), false)
  assert.equal(firstRejectedDoc(reuploaded)?.key, 'photo')
  assert.equal(firstRejectedDoc(reuploaded)?.awaitingReview, true) // being re-reviewed
  // only an APPROVAL (reason cleared, status approved) restores it.
  const approved = docs({ photo: { rawStatus: 'approved', reasonPresent: false } })
  assert.equal(tutorVerifiedBadgeOk(true, approved), true)
})

test('the mapper maps a lingering rejection reason to blocked even at pending', () => {
  const d = tutorDocStatusesFromProfile(
    { selfie_status: 'pending', selfie_reason: 'blurry', avatar_url: 'x', verification_state: 'approved', cnic_verified_at: '2026-01-01', cnic_number: '12345-1234567-1', cnic_image_path: 'p', profile_pic_status: 'approved' },
    true,
  )
  assert.equal(d.selfie.reasonPresent, true)
  assert.equal(tutorDocRejected(d), true)
})

// ----------------------------------------------- server gates (scans) -------
test('every tutor activity gate is blocked server-side on a rejected document', () => {
  assert.match(read('lib/applications.ts'), /ent\.docRejected && ent\.rejectedDoc/, 'apply blocked')
  assert.match(read('lib/messaging.ts'), /docRejected && ent\.rejectedDoc/, 'start conversation blocked')
  assert.match(read('lib/messaging.ts'), /sEnt\.docRejected && sEnt\.rejectedDoc/, 'send/reply blocked')
  assert.match(read('lib/contactReveal.ts'), /ent\.docRejected && ent\.rejectedDoc/, 'contact reveal blocked')
  assert.match(read('app/api/demo/respond/route.ts'), /ent\.docRejected && ent\.rejectedDoc/, 'demo accept blocked')
  assert.match(read('lib/entitlements.ts'), /tutorVerifiedBadgeOk\(feePaid, tutorDocs\)/, 'badge uses the shared rule')
})

test('the dashboard shows verified / re-upload instead of "reviewing documents"', () => {
  const dash = read('app/(site)/tutor/dashboard/page.tsx')
  // The verified line moved into the once-only banner (owner, 5 Oct 2026,
  // migration 135): the dashboard renders VerifiedOnceBanner, which carries it.
  assert.match(dash, /VerifiedOnceBanner/)
  assert.match(read('components/tutor/VerifiedOnceBanner.tsx'), /You&rsquo;re verified! You can now apply to tuitions\./)
  assert.match(dash, /Please upload a correct \{ent\.rejectedDoc\.label\} to continue\./)
  assert.ok(!/reviewing your documents/.test(dash), 'the old "reviewing documents" line is gone')
})

// ----------------------------------------------- STEP 2.7: re-upload alert --
test('re-upload re-queues and alerts staff; identity keeps the reason until approval', () => {
  assert.match(read('app/api/documents/upload/route.ts'), /alertIfReupload\(user\.id, kind\)/)
  const id = read('app/api/identity/route.ts')
  assert.match(id, /alertIfReupload\(user\.id, 'cnic'\)/)
  // The SUBMIT path keeps the reason until approval (the reopen/withdraw branch
  // may still clear it — that is a different action). Assert the submit intent.
  assert.match(id, /do NOT clear verification_rejection_reason here/, 'CNIC re-submit keeps the reason')
  assert.match(read('lib/payments/paymentAlerts.ts'), /sendReuploadAlert/)
})

// ----------------------------------------------- STEP 3: duplicate CNIC -----
test('a CNIC already on another account is refused with the exact message + alert', () => {
  const id = read('app/api/identity/route.ts')
  assert.match(id, /cnic_in_use/, 'checks the guard function')
  assert.match(id, /This CNIC is already registered on TutorMint\. Message us on WhatsApp 0321 5872222 if this is a mistake\./)
  assert.match(id, /sendDuplicateCnicAlert/, 'raises a staff alert')
  assert.match(id, /isValidCnic/, '13-digit check enforced server-side')
  assert.match(read('supabase/migrations/102_refunds_and_cnic_guard.sql'), /length\(p_digits\) = 13/)
})

// ----------------------------------------------- STEP 4: refunds ------------
test('refund math: state, label and amount resolution', () => {
  assert.equal(refundState(199, 0), 'none')
  assert.equal(refundState(199, 199), 'full')
  assert.equal(refundState(199, 100), 'partly')
  assert.equal(refundLabel(refundState(199, 199)), 'Refunded')
  assert.equal(refundLabel(refundState(199, 100)), 'Partly refunded')
  // default = full remaining
  assert.deepEqual(resolveRefundAmount(null, 199, 0), { ok: true, amount: 199 })
  assert.deepEqual(resolveRefundAmount(null, 199, 50), { ok: true, amount: 149 })
  // cannot over-refund
  assert.equal(resolveRefundAmount(500, 199, 0).ok, false)
  assert.equal(resolveRefundAmount(100, 199, 150).ok, false) // 150+100 > 199
  assert.equal(resolveRefundAmount(null, 199, 199).ok, false) // already full
})

test('refunds are owner/admin + fresh password, audited, net revenue, paid status kept', () => {
  const route = read('app/api/admin/payments/refund/route.ts')
  // Owner only since 8 Oct 2026 (item 3: money is an owner area).
  assert.match(route, /checkAdminRole\(\.\.\.SCREEN_ACCESS\.paymentsRefund\)/, 'owner only')
  assert.match(route, /requireFreshAuth/, 'fresh password')
  const fn = read('lib/payments/refund.ts')
  assert.match(fn, /logAdminAction\([^]*payment\.refund/, 'audited')
  assert.match(fn, /event: 'refund_recorded'/, 'on the member history')
  assert.ok(!/verified_fee_paid_at:/.test(fn), 'a refund never writes paid status')
  // Revenue (8 Oct 2026, Finance): a refunded payment is left out of every
  // total and listed on its own — never netted into revenue.
  assert.match(read('lib/financeCore.ts'), /if \(\(p\.refundedAmountPkr \?\? 0\) > 0 \|\| p\.refundedAt\) return 'refunded'/, 'refunds kept out of revenue')
})

test('Payments & refunds section + notification wired', () => {
  assert.match(read('app/(site)/tutor/dashboard/page.tsx'), /<PaymentsRefunds rows=\{paymentsHistory\}/)
  assert.match(read('app/(site)/parent/dashboard/page.tsx'), /<PaymentsRefunds rows=\{paymentsHistory\}/)
  assert.match(read('lib/payments/refund.ts'), /kind: 'refund_recorded'/, 'in-app notification')
  assert.match(read('lib/payments/refund.ts'), /id: 'refund_recorded'/, 'refund email')
})

// ----------------------------------------------- STEP 5: draft --------------
test('Post a tuition autosaves a draft and clears it on post / discard', () => {
  const form = read('components/forms/PostTuitionForm.tsx')
  assert.match(form, /saveFormDraft\(draftKey, \{ v, scheduleSlots \}\)/, 'autosaves on change')
  assert.match(form, /loadFormDraft<\{ v: PostTuitionValues; scheduleSlots: DaySlot\[\] \}>\(draftKey\)/, 'restores on mount')
  assert.match(form, /if \(draftKey\) clearFormDraft\(draftKey\)/, 'clears on post')
  assert.match(form, /Discard draft/, 'discard button')
  assert.match(read('lib/formDraft.ts'), /localStorage/, 'survives a closed tab')
  assert.match(read('app/(site)/parent/dashboard/post-job/page.tsx'), /draftKey=\{`post-tuition:parent:\$\{userId\}`\}/)
  assert.match(read('app/admin/jobs/new/page.tsx'), /draftKey=\{`post-tuition:admin:\$\{actor\.id\}`\}/)
})
