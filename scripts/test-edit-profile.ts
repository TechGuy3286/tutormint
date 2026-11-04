/**
 * scripts/test-edit-profile.ts — npm run test:editprofile
 *
 * "Edit Profile" (owner, 4 Nov 2026):
 *   • the member's Settings page is called Edit Profile — header, page title,
 *     links — at the SAME address (no redirect is needed; the old address is the
 *     address);
 *   • the Verification Fee card is gone from it; Step 1 counts its six cards;
 *   • only Mobile, CNIC and Email are locked for a member, each refused on the
 *     server; staff still change them (lib/memberLocksCore, migration 222);
 *   • every other field stays editable after approval;
 *   • a tutor with an approved CNIC who changes their name is flagged for the
 *     Owner ("Name changed — check against CNIC");
 *   • a replaced photo or selfie goes back to review: the badge stays, the old
 *     photo stays public until approval, a reject keeps the old one;
 *   • no Urdu in the locked boxes.
 * Pure rules, server renders and source scans. The database behaviour is proven
 * on production by scripts/test-edit-profile-live.ts (all rolled back).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'

import MemberHeaderNav from '../components/MemberHeaderNav'
import AccountLinks from '../components/dashboard/AccountLinks'
import MemberLockBox from '../components/account/MemberLockBox'
import DocLockNotice from '../components/identity/DocLockNotice'
import { StatusCard } from '../components/tutor/SettingsPieces'
import { EDIT_PROFILE_LABEL, MEMBER_SETTINGS_HREF } from '../lib/memberNav'
import {
  MEMBER_LOCK_LINE,
  cnicLocked,
  emailLocked,
  memberLockRefusal,
  mobileLocked,
  nameChangeNeedsCheck,
  NAME_CHANGED_LABEL,
  photoRereviewOutcome,
  replaceDecision,
} from '../lib/memberLocksCore'
import { uploadDecision, lockView, photoLockView, photoUploadDecision, canReplace } from '../lib/docLockCore'
import { tutorCardStatuses, tutorWaiting } from '../lib/tutorDocQueueCore'
import { fillRereviewRejected, REREVIEW_DEFAULT } from '../lib/rereviewTemplateCore'
import { groupTemplateInfo } from '../lib/templateRules'

const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {}, hmrRefresh() {} }
const render = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router as never }, el))
const src = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const URDU = /[؀-ۿ]/
const TUTOR = 'app/(site)/tutor/dashboard/settings/page.tsx'

// ------------------------------------------------------------------ rename --
test('the header says Edit Profile and points at the unchanged address', () => {
  assert.equal(EDIT_PROFILE_LABEL, 'Edit Profile')
  for (const role of ['tutor', 'parent'] as const) {
    const html = render(createElement(MemberHeaderNav, { settingsHref: MEMBER_SETTINGS_HREF[role] }))
    assert.match(html, new RegExp(`href="${MEMBER_SETTINGS_HREF[role]}"[^>]*>.*Edit Profile</span></a>`))
    assert.doesNotMatch(html, />Settings</)
  }
  assert.equal(MEMBER_SETTINGS_HREF.tutor, '/tutor/dashboard/settings')
  assert.equal(MEMBER_SETTINGS_HREF.parent, '/parent/dashboard/settings')
  // The address did not change, so the page files are still at it — nothing to redirect.
  assert.ok(existsSync(TUTOR))
  assert.ok(existsSync('app/(site)/parent/dashboard/settings/page.tsx'))
})

test('the dashboard card link and the page titles say Edit Profile', () => {
  const html = render(createElement(AccountLinks, { settingsHref: MEMBER_SETTINGS_HREF.tutor }))
  assert.match(html, /Edit Profile/)
  assert.doesNotMatch(html, />\s*Settings\s*</)
  assert.match(src('app/(site)/tutor/dashboard/settings/layout.tsx'), /title: `\$\{EDIT_PROFILE_LABEL\} \| TutorMint`/)
  assert.match(src(TUTOR), /<h1[^>]*>Edit Profile<\/h1>/)
  const parent = src('app/(site)/parent/dashboard/settings/page.tsx')
  assert.match(parent, /title: 'Edit Profile \| TutorMint'/)
  assert.match(parent, /\{ label: 'Edit Profile' \}/)
  for (const f of ['components/cv/CvClient.tsx', 'components/identity/IdentityStatusLine.tsx', 'app/(site)/browse/tuitions/BrowseTuitionsView.tsx']) {
    assert.doesNotMatch(src(f), /Complete in Settings|Edit in Settings|>\s*Settings\s*</, f)
  }
})

// ----------------------------------------------------- Verification Fee card --
function step1Keys(): string[] {
  const s = src(TUTOR)
  const block = s.slice(s.indexOf('const step1Cards'), s.indexOf('const step2Cards'))
  return [...block.matchAll(/\n\s{6}key: '([a-zA-Z]+)',/g)].map((m) => m[1])
}
test('the Verification Fee card is gone and Step 1 counts six cards', () => {
  const keys = step1Keys()
  assert.deepEqual(keys, ['mobile', 'cnic', 'profilePic', 'selfie', 'subjects', 'location'])
  assert.ok(!keys.includes('fee'))
  // The count reads "N of <step1Cards.length> done" — six.
  assert.match(src(TUTOR), /<StepHeader section="step1" done=\{step1Done\} total=\{step1Cards\.length\} \/>/)
  assert.doesNotMatch(src(TUTOR), /ReadonlyLine kind="fee"/)
})

// ------------------------------------------------------------- the locks --
test('only Mobile, CNIC and Email lock — with the owner’s English lines', () => {
  assert.equal(MEMBER_LOCK_LINE.mobile, 'To change your mobile number, please contact our support.')
  assert.equal(MEMBER_LOCK_LINE.cnic, 'To change your CNIC, please contact our support.')
  assert.equal(MEMBER_LOCK_LINE.email, 'To change your email, please contact our support.')
  assert.equal(mobileLocked({ phoneVerifiedAt: '2026-10-01T00:00:00Z' }), true)
  assert.equal(mobileLocked({ phoneVerifiedAt: null }), false, 'an unverified mobile can still be verified')
  assert.equal(emailLocked({ authEmail: 'ayesha@example.com' }), true)
  assert.equal(emailLocked({ authEmail: '923001234567@users.tutormint.org' }), false, 'a mobile sign-up may add one')
  assert.equal(emailLocked({ authEmail: null }), false)
  assert.equal(cnicLocked({ cnicVerifiedAt: '2026-10-01' }), true)
  assert.equal(cnicLocked({ verificationState: 'approved' }), true)
  assert.equal(cnicLocked({ verificationState: 'submitted' }), false)
  assert.deepEqual(memberLockRefusal('email'), { status: 403, error: MEMBER_LOCK_LINE.email, locked: true })
})

test('the member email change is refused on the server before anything is sent', () => {
  const s = src('app/api/account/email/route.ts')
  const lock = s.indexOf('emailLocked({ authEmail')
  assert.ok(lock > 0 && lock < s.indexOf('requestEmailChange({'), 'the lock check runs first')
  assert.match(src('app/api/auth/otp/route.ts'), /MEMBER_LOCK_LINE\.mobile, locked: true/)
  assert.match(src('app/api/auth/phone/route.ts'), /MEMBER_LOCK_LINE\.mobile/)
  // The CNIC routes refuse with the CNIC line.
  assert.match(src('app/api/identity/route.ts'), /LOCKED_ERROR/)
  assert.equal(uploadDecision({ kind: 'cnic', part: 'front', approved: true, partOnRecord: true, unlock: null }).allow, false)
  const refused = uploadDecision({ kind: 'cnic', part: 'front', approved: true, partOnRecord: true, unlock: null })
  assert.equal(!refused.allow && refused.error, MEMBER_LOCK_LINE.cnic)
  // Staff keep their own routes (admin), which check staff access, not these locks.
  assert.match(src('app/api/admin/members/route.ts'), /change-mobile|changeMobile/)
  assert.match(src('supabase/migrations/222_member_edit_rules.sql'), /tm_member_self_edit\(\)/)
})

// ----------------------------------------------- editable after approval --
test('the photo and the selfie are never locked — a replacement goes to review', () => {
  for (const v of [
    photoLockView({ approved: true, onRecord: true, rereviewPending: false, unlockOpen: false }),
    photoLockView({ approved: true, onRecord: true, rereviewPending: true, unlockOpen: false }),
    lockView({ part: 'selfie', approved: true, partOnRecord: true, reviewPending: false, unlock: null }),
    lockView({ part: 'selfie', approved: true, partOnRecord: true, reviewPending: true, unlock: null }),
  ]) {
    assert.notEqual(v, 'locked')
    assert.ok(canReplace(v))
  }
  assert.deepEqual(photoUploadDecision({ approved: true, onRecord: true, unlockOpen: false }), { allow: true })
  const selfie = uploadDecision({ kind: 'selfie', part: 'selfie', approved: true, partOnRecord: true, unlock: null })
  assert.ok(selfie.allow && selfie.mode === 'review', 'an approved selfie is replaced into review')
  assert.equal(replaceDecision({ approved: true, onRecord: true }), 'review')
  assert.equal(replaceDecision({ approved: false, onRecord: true }), 'normal')
})

test('every other Edit Profile card has no lock', () => {
  const s = src(TUTOR)
  const locked = [...s.matchAll(/\n\s{6}key: '([a-zA-Z]+)',[\s\S]*?(?=\n\s{4}\},?\n)/g)]
    .filter((m) => /\n\s{6}locked:/.test(m[0]))
    .map((m) => m[1])
  assert.deepEqual(locked.sort(), ['cnic', 'email', 'mobile'])
  assert.doesNotMatch(s, /approvedLock: /)
  for (const f of ['app/api/profile/photo/route.ts', 'app/api/documents/upload/route.ts', 'app/api/profile/save/route.ts']) {
    assert.doesNotMatch(src(f), /decidePhotoUpload|Approved 🔒/, f)
  }
  // The database lock functions keep only the mobile and the CNIC number.
  const m = src('supabase/migrations/222_member_edit_rules.sql')
  const lockFn = m.slice(m.indexOf('create or replace function public.lock_profile_fields'), m.indexOf('create or replace function public.lock_tutor_profile_fields'))
  assert.doesNotMatch(lockFn, /tm_photo_change_refused|tutor_step1_complete|full_name|whatsapp/)
})

// ------------------------------------------------------------ name flag --
test('a tutor with an approved CNIC changing their name is flagged, never blocked', () => {
  assert.equal(nameChangeNeedsCheck({ role: 'tutor', cnicApproved: true, oldName: 'Ali Raza', newName: 'Ali Raza Khan' }), true)
  assert.equal(nameChangeNeedsCheck({ role: 'tutor', cnicApproved: true, oldName: 'Ali Raza', newName: '  ali   raza ' }), false)
  assert.equal(nameChangeNeedsCheck({ role: 'tutor', cnicApproved: false, oldName: 'A', newName: 'B' }), false)
  assert.equal(nameChangeNeedsCheck({ role: 'parent', cnicApproved: true, oldName: 'A', newName: 'B' }), false)
  assert.equal(NAME_CHANGED_LABEL, 'Name changed — check against CNIC')
  const base = { hasSelfieFile: true, verification_state: 'approved', cnic_verified_at: '2026-10-01', cnic_number: '4210112345671', cnic_image_path: 'x', avatar_url: 'a', profile_pic_status: 'approved', selfie_status: 'approved' }
  assert.deepEqual(tutorWaiting({ ...base, name_rereview_at: '2026-11-04T10:00:00Z' }), [NAME_CHANGED_LABEL])
  assert.deepEqual(tutorWaiting(base), [])
  // The trigger saves the name and only stamps the flag.
  const m = src('supabase/migrations/222_member_edit_rules.sql')
  assert.match(m, /new\.name_rereview_at := now\(\);/)
  assert.doesNotMatch(m.slice(m.indexOf('create or replace function public.flag_member_name_change')), /raise exception/i)
})

// -------------------------------------------------- photo / selfie review --
test('a replaced photo or selfie waits: badge kept, old photo public, reject keeps old', () => {
  const approved = { hasSelfieFile: true, verification_state: 'approved', cnic_verified_at: '2026-10-01', cnic_number: '4210112345671', cnic_image_path: 'x', avatar_url: 'https://x/old.jpg', profile_pic_status: 'approved', selfie_status: 'approved' }
  const s = tutorCardStatuses({ ...approved, profile_pic_rereview_at: '2026-11-04', hasSelfieReview: true })
  assert.equal(s.profilePic.status, 'pending')
  assert.equal(s.profilePic.rereview, true)
  assert.equal(s.selfie.rereview, true)
  assert.deepEqual(tutorWaiting({ ...approved, profile_pic_rereview_at: '2026-11-04', hasSelfieReview: true }), ['Photo', 'Selfie'])
  // The approval columns the badge reads are not touched by a replacement:
  // the database holds the new photo in avatar_pending_url and keeps avatar_url.
  const m = src('supabase/migrations/222_member_edit_rules.sql')
  assert.match(m, /new\.avatar_pending_url := new\.avatar_url;/)
  assert.match(m, /new\.avatar_url := old\.avatar_url;/)
  assert.doesNotMatch(m.slice(m.indexOf('create or replace function public.hold_member_photo'), m.indexOf('revoke all on function public.hold_member_photo')), /profile_pic_status\s*:?=/)
  // The Owner's decision.
  assert.deepEqual(photoRereviewOutcome({ approve: true, pendingUrl: 'https://x/new.jpg' }), { newAvatarUrl: 'https://x/new.jpg', keepOld: false, rejectPhoto: false })
  assert.deepEqual(photoRereviewOutcome({ approve: false, pendingUrl: 'https://x/new.jpg' }), { newAvatarUrl: null, keepOld: true, rejectPhoto: false })
  assert.deepEqual(photoRereviewOutcome({ approve: false, pendingUrl: null }), { newAvatarUrl: null, keepOld: false, rejectPhoto: true })
  // A selfie reject hides the new file and keeps the approved one (lib/docLocks rejectReview).
  assert.match(src('lib/tutorDocuments.ts'), /await rejectReview\(tutorId, item\)/)
  // The member is told why: in-app (notify) + the English WhatsApp template.
  const msg = fillRereviewRejected(REREVIEW_DEFAULT, { firstName: 'Ali', document: 'profile picture', reason: 'Reason: face not clear.', link: 'https://www.tutormint.org/tutor/dashboard/settings', supportWhatsapp: '0321 5872222' })
  assert.match(msg, /Your new profile picture was not approved: Reason: face not clear\./)
  assert.match(msg, /earlier approved profile picture is still on your profile/)
  assert.doesNotMatch(msg, URDU)
  assert.ok(groupTemplateInfo('rereview_rejected'))
  // Each change is on the Activity tab.
  assert.match(src('app/api/profile/photo/route.ts'), /event: 'document_uploaded'[\s\S]*kind: 'photo'/)
  assert.match(src('app/api/documents/upload/route.ts'), /event: 'document_uploaded'/)
  // The selfie stays camera-only.
  assert.match(src(TUTOR), /<LiveSelfieCapture/)
})

// ------------------------------------------------------------ no Urdu --
test('the locked boxes carry no Urdu', () => {
  for (const field of ['mobile', 'cnic', 'email'] as const) {
    const html = render(createElement(MemberLockBox, { field, value: 'masked' }))
    assert.doesNotMatch(html, URDU, field)
    assert.match(html, new RegExp(MEMBER_LOCK_LINE[field]))
    assert.match(html, /WhatsApp 0321 5872222/)
    assert.match(html, /api\.whatsapp\.com\/send\?phone=923215872222/)
  }
  assert.doesNotMatch(render(createElement(DocLockNotice, { view: 'locked', doc: 'cnic' })), URDU)
  for (const cardKey of ['mobile', 'cnic', 'email']) {
    const html = render(
      createElement(StatusCard, { cardKey, status: 'completed', locked: true, lockedNote: createElement(MemberLockBox, { field: cardKey as 'mobile' }), children: null }),
    )
    assert.doesNotMatch(html, URDU, `${cardKey} card`)
    assert.doesNotMatch(html, /Approved 🔒/)
  }
})
