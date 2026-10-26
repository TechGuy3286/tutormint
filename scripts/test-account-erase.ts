/**
 * scripts/test-account-erase.ts — Close account and erase data (owner,
 * 27 Oct 2026). Pure rules (lib/accountEraseCore), the proxy's hashed 301, and
 * source checks of the routes and the erase. Invented data only; no database.
 *   npx tsx --test scripts/test-account-erase.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import {
  DELETED_MESSAGE,
  ERASED_NAME,
  ERASE_CONFIRMATION,
  ERASE_GRACE_DAYS,
  PROFILE_FIELDS_CLEARED,
  TUTOR_FIELDS_CLEARED,
  authUserDecision,
  eraseAuditLine,
  eraseCancellable,
  eraseCountdown,
  eraseDueAt,
  eraseIsDue,
  eraseRequestProblem,
  eraseTargetProblem,
  erasedEmail,
  erasedSlug,
  erasedTutorTarget,
  filesToRemove,
  isErasedEmail,
  maskNote,
  normaliseSlug,
  pendingBannerText,
  profileErasePatch,
  scrubPaymentRaw,
  selfDeleteProblem,
  storageFileFromUrl,
  tutorErasePatch,
} from '../lib/accountEraseCore'
import { sha256Slug } from '../lib/erasedTutorRedirect'
import { recipientProblem, isSyntheticAddress } from '../lib/notify/recipient'
import { excludedReason } from '../lib/peopleDirectoryCore'

const ID = '11111111-2222-4333-8444-555555555555'
const NOW = Date.UTC(2026, 9, 27, 6, 0, 0)
const src = (p: string) => readFileSync(p, 'utf8')

test('erase: every personal profile field is cleared, counts-facts kept', () => {
  const patch = profileErasePatch(ID, new Date(NOW).toISOString())
  for (const f of PROFILE_FIELDS_CLEARED) assert.ok(f in patch, `${f} is in the patch`)
  assert.equal(patch.full_name, ERASED_NAME)
  assert.equal(patch.email, erasedEmail(ID))
  assert.equal(patch.phone_number, '')
  for (const f of ['whatsapp', 'secondary_phone', 'cnic_number', 'cnic_image_path', 'address', 'area', 'avatar_url']) assert.equal(patch[f], null, f)
  // Never touched: what counts, revenue and history rely on.
  for (const keep of ['role', 'city', 'created_at', 'hidden_from_public', 'is_seed', 'is_team_account', 'utm_source', 'cnic_verified_at', 'verification_state'])
    assert.ok(!(keep in patch), `${keep} is kept`)
  assert.equal(patch.erased_at, new Date(NOW).toISOString())
})

test('erase: tutor profile text, documents, video and areas are cleared; slug has no name', () => {
  const patch = tutorErasePatch(ID)
  for (const f of TUTOR_FIELDS_CLEARED) assert.ok(f in patch, `${f} is in the tutor patch`)
  assert.equal(patch.headline, null)
  assert.equal(patch.bio, null)
  assert.deepEqual(patch.degrees, [])
  assert.equal(patch.video_youtube_id, null)
  assert.equal(patch.slug, erasedSlug(ID))
  assert.match(String(patch.slug), /^deleted-[0-9a-f]{10}$/)
  assert.equal(patch.slug_locked, true)
  // Areas are rows, removed by the erase.
  assert.match(src('lib/accountErase.ts'), /from\('tutor_areas'\)\.delete\(\)\.eq\('tutor_id', id\)/)
})

test('erase: an erased account is not a test/staff account — People counts do not change', () => {
  assert.ok(!/\btest\b/i.test(ERASED_NAME))
  assert.notEqual(ERASED_NAME.toLowerCase(), 'new user')
  const before = { role: 'tutor', mergedInto: null, isSeed: false, isTeam: false, isTestName: false, hidden: false, staffLinked: false, activity: true }
  assert.equal(excludedReason(before as never), null)
  assert.equal(excludedReason({ ...before } as never), null, 'same facts after the erase')
})

test('erase: CNIC images, photo, selfie, receipts and attachments are the files removed', () => {
  const files = filesToRemove({
    documents: [
      { original_path: `${ID}/cnic-front.jpg`, preview_path: `${ID}/cnic-front-preview.jpg` },
      { original_path: `${ID}/selfie.jpg`, preview_path: null },
    ],
    receipts: [{ screenshot_path: `${ID}/receipt.jpg`, refund_proof_path: null }],
    messageAttachments: [`${ID}/photo1.jpg`, null],
    publicUrls: [
      `https://abc.supabase.co/storage/v1/object/public/avatars/${ID}/photo-1-crop.jpg`,
      `https://abc.supabase.co/storage/v1/object/public/avatars/${ID}/photo-1-crop.jpg`,
      null,
      'https://example.com/not-ours.jpg',
    ],
  })
  const keys = files.map((f) => `${f.bucket}:${f.path}`).sort()
  assert.deepEqual(keys, [
    `avatars:${ID}/photo-1-crop.jpg`,
    `identity-docs:${ID}/cnic-front-preview.jpg`,
    `identity-docs:${ID}/cnic-front.jpg`,
    `identity-docs:${ID}/selfie.jpg`,
    `message-media:${ID}/photo1.jpg`,
    `payment-proofs:${ID}/receipt.jpg`,
  ])
  assert.deepEqual(storageFileFromUrl('https://abc.supabase.co/storage/v1/object/public/tutor-media/a/b%20c.png'), { bucket: 'tutor-media', path: 'a/b c.png' })
  assert.equal(storageFileFromUrl(null), null)
  // Every bucket folder under the member's id is listed and emptied too.
  assert.match(src('lib/accountErase.ts'), /for \(const bucket of ERASE_BUCKETS\)/)
})

test('erase: message contents become "[deleted]" and staff notes are masked', () => {
  assert.equal(DELETED_MESSAGE, '[deleted]')
  const s = src('lib/accountErase.ts')
  assert.match(s, /from\('messages'\)\.update\(\{ body: DELETED_MESSAGE, message: DELETED_MESSAGE/)
  assert.match(s, /from\('member_notes'\)\.update\(\{ body: masked \}\)/)
  assert.equal(maskNote('Called on 0300 1234567, email a.b@example.com'), 'Called on [hidden], email [hidden]')
  assert.equal(maskNote('Wants Grade 5 maths'), 'Wants Grade 5 maths')
})

test('erase: the auth user is scrubbed, not deleted, because it cascades into kept records', () => {
  // The ON DELETE CASCADE children of auth.users, read live on 27 Oct 2026.
  const live = ['abuse_flags', 'activity_events', 'applications', 'application_follow_ups', 'jobs', 'member_follow_ups', 'member_notes', 'payments', 'profiles', 'subscriptions', 'tutor_profiles', 'notifications']
  assert.equal(authUserDecision(live), 'scrub')
  assert.equal(authUserDecision(['notifications', 'saved_jobs']), 'delete')
  const s = src('lib/accountErase.ts')
  assert.match(s, /rpc\('erase_auth_user', \{ p_uid: id \}\)/)
  assert.doesNotMatch(s, /auth\.admin\.deleteUser/)
  const m = src('supabase/migrations/203_account_erase.sql')
  for (const bit of ["email = 'erased-' || p_uid::text || '@users.tutormint.org'", 'phone = null', "encrypted_password = ''", 'delete from auth.identities', 'delete from auth.sessions', "banned_until = now() + interval '100 years'"])
    assert.ok(m.includes(bit), bit)
  // The address is freed and never mailed.
  assert.ok(isErasedEmail(erasedEmail(ID)))
  assert.ok(isSyntheticAddress(erasedEmail(ID)))
  assert.notEqual(recipientProblem(erasedEmail(ID)), null)
})

test('erase: payments are kept — only receipt files and personal payload fields go', () => {
  const s = src('lib/accountErase.ts')
  assert.doesNotMatch(s, /from\('payments'\)\.delete/)
  assert.match(s, /from\('payments'\)\.update\(\{ screenshot_path: null, refund_proof_path: null, raw: scrubPaymentRaw/)
  const raw = { amount: 199, reference: 'RAAST-123', customer_name: 'Invented Name', CustomerMobile: '03001234567', nested: { payerEmail: 'x@example.com', status: 'PAID' }, note: 'paid by 03001234567' }
  assert.deepEqual(scrubPaymentRaw(raw), { amount: 199, reference: 'RAAST-123', nested: { status: 'PAID' }, note: 'paid by [hidden]' })
})

test('erase: 301 targets — tutor to Find tutors for the city; tuitions hidden like hidden-parent tuitions', async () => {
  assert.equal(erasedTutorTarget('Lahore'), '/browse/tutors?city=Lahore')
  assert.equal(erasedTutorTarget('Rahim Yar Khan'), '/browse/tutors?city=Rahim%20Yar%20Khan')
  assert.equal(erasedTutorTarget(null), '/browse/tutors')
  // The proxy (Web Crypto) and the erase (node crypto) hash an address the same way.
  const node = (s: string) => createHash('sha256').update(normaliseSlug(s)).digest('hex')
  assert.equal(await sha256Slug('Invented-Person-Tutor'), node('invented-person-tutor'))
  assert.equal(await sha256Slug('invented%2Dperson-tutor'), node('invented-person-tutor'))
  const proxy = src('proxy.ts')
  assert.match(proxy, /erasedTutorRedirectPath\(request\.nextUrl\.pathname\)/)
  assert.match(proxy, /NextResponse\.redirect\(target, 301\)/)
  const m = src('supabase/migrations/203_account_erase.sql')
  assert.match(m, /when p\.erased_at is not null then 'parent_erased'/)
  assert.match(m, /after update of is_banned, is_suspended, hidden_from_public, full_name, erased_at/)
  // Out of the directory (Browse, search, sitemap): the erase sets is_suspended.
  assert.equal(profileErasePatch(ID, 'x').is_suspended, true)
})

test('erase: grace period — 7 days by default, due only once the time is up, cancellable until it runs', () => {
  assert.equal(ERASE_GRACE_DAYS, 7)
  assert.equal(eraseDueAt(NOW, 'later').getTime(), NOW + 7 * 86_400_000)
  assert.equal(eraseDueAt(NOW, 'now').getTime(), NOW)
  const due = NOW + 7 * 86_400_000
  assert.equal(eraseIsDue({ status: 'scheduled', dueAtMs: due }, NOW), false)
  assert.equal(eraseIsDue({ status: 'scheduled', dueAtMs: due }, due), true)
  assert.equal(eraseIsDue({ status: 'cancelled', dueAtMs: due }, due + 1), false)
  assert.equal(eraseCancellable({ status: 'scheduled', dueAtMs: due }), true)
  assert.equal(eraseCancellable({ status: 'done', dueAtMs: due }), false)
  assert.equal(eraseCancellable(null), false)
  assert.equal(eraseCountdown(due, NOW), 'Erases in 7 days')
  assert.equal(eraseCountdown(NOW + 5 * 3_600_000, NOW), 'Erases in 5 hours')
  assert.match(eraseCountdown(NOW - 1, NOW), /next daily run/)
  assert.equal(pendingBannerText(new Date(due)), 'Your account will be deleted on 3 Nov 2026')
  // The daily cron runs what is due.
  assert.match(src('app/api/cron/subscriptions/route.ts'), /runDueErasures\(\)/)
  assert.match(src('lib/accountErase.ts'), /\.eq\('status', 'scheduled'\)\.lte\('due_at'/)
})

test('erase: the owner request needs a reason and how identity was confirmed', () => {
  assert.equal(eraseRequestProblem({ reason: 'Asked by email', identityCheck: 'Email matches account', mode: 'later' }), null)
  assert.ok(eraseRequestProblem({ reason: '', identityCheck: 'Email matches account', mode: 'later' }))
  assert.ok(eraseRequestProblem({ reason: 'Asked by email', identityCheck: '', mode: 'now' }))
  assert.ok(eraseRequestProblem({ reason: 'Asked by email', identityCheck: 'x y z', mode: 'soon' }))
  assert.equal(eraseTargetProblem({ role: 'tutor', admin_role: null, erased_at: null }), null)
  assert.ok(eraseTargetProblem({ role: 'admin', admin_role: 'operations', erased_at: null }))
  assert.ok(eraseTargetProblem({ role: 'parent', admin_role: null, erased_at: '2026-10-01' }))
  assert.equal(eraseTargetProblem({ role: 'parent', admin_role: null, erased_at: '2026-10-01' }, { retry: true }), null)
  assert.equal(eraseAuditLine({ reason: 'Asked by email', byName: 'Invented Owner', at: new Date(NOW) }), 'Account erased on request · Asked by email · by Invented Owner · 27 Oct 2026')
  assert.equal(ERASE_CONFIRMATION, 'Your TutorMint account has been closed and your personal data deleted.')
})

test('erase: the confirmation email goes out BEFORE the address is cleared', () => {
  const s = src('lib/accountErase.ts')
  const send = s.indexOf("{ id: 'account_erased'")
  const clear = s.indexOf("from('profiles').update(profileErasePatch(id, now))")
  assert.ok(send > 0 && clear > 0 && send < clear)
})

test('erase: owner-only route — 401 signed out, 403 everyone else, password re-checked', () => {
  const r = src('app/api/admin/members/erase/route.ts')
  for (const method of ['GET', 'POST']) {
    const body = r.slice(r.indexOf(`export async function ${method}`))
    const gate = body.indexOf('checkAdminRole(')
    const owner = body.indexOf('refuseUnlessOwnerApproval(')
    assert.ok(gate >= 0 && owner > gate, `${method}: signed-out/role gate then Owner-only`)
  }
  const post = r.slice(r.indexOf('export async function POST'))
  assert.ok(post.indexOf('requireFreshAuth(') < post.indexOf('scheduleErase('), 'password before the erase')
  const admin = src('lib/adminAccessCore.ts')
  assert.match(admin, /convertAccount: \[\] as AdminRole\[\]/)
})

test('erase: self-serve "Delete my account" is confirmed by an SMS code to the verified mobile', () => {
  assert.equal(selfDeleteProblem({ phoneVerified: true, phone: '923001234567', isStaff: false, erased: false }), null)
  assert.ok(selfDeleteProblem({ phoneVerified: false, phone: '923001234567', isStaff: false, erased: false }))
  assert.ok(selfDeleteProblem({ phoneVerified: true, phone: null, isStaff: false, erased: false }))
  assert.ok(selfDeleteProblem({ phoneVerified: true, phone: '923001234567', isStaff: true, erased: false }))
  const r = src('app/api/account/delete/route.ts')
  assert.match(r, /auth\.getUser\(\)/)
  assert.match(r, /sendOtp\(\{ phone, purpose: 'erase', userId: who\.id \}\)/)
  const confirm = r.slice(r.indexOf("const code = (parsed.data.code"))
  assert.ok(confirm.indexOf("verifyOtp({ phone, code, purpose: 'erase'") < confirm.indexOf('scheduleErase('), 'code checked before scheduling')
  assert.match(confirm, /mode: 'later'/)
  const otp = src('lib/otp.ts')
  assert.match(otp, /export type OtpPurpose = 'verify' \| 'reset' \| 'erase'/)
  assert.match(otp, /return p === 'reset' \|\| p === 'erase'/)
  assert.match(src('supabase/migrations/203_account_erase.sql'), /'verify'::text, 'reset'::text, 'erase'::text/)
  // The banner on both dashboards, with Cancel.
  for (const f of ['app/(site)/tutor/dashboard/layout.tsx', 'app/(site)/parent/dashboard/layout.tsx']) assert.match(src(f), /<ErasePendingBanner userId=\{session\.user\.id\} \/>/)
  assert.match(src('components/account/CancelEraseButton.tsx'), /action: 'cancel'/)
})
