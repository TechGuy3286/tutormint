/**
 * scripts/test-nov2-push1.ts — npm run test:nov2push1
 *
 * Push 1 of the 2 Nov 2026 PR (owner): poster-only Move to top / Keep it open,
 * fewer Urdu lines in messages, the "Verified tuition" badge, onboarding
 * windows on a laptop, Tagline & About editing, staff joining dates and the
 * self-referral block. Pure rules + source scans; no DB, browser or network.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { posterToolsVisible, moveToTopState, keepOpenNotice, REFRESH_BOX_TEXT, MOVE_TO_TOP_LABEL, KEEP_OPEN_LABEL, nextMoveLine } from '../lib/posterToolsCore'
import { VERIFIED_TUITION_LABEL, TEAM_POSTER_LABEL } from '../lib/teamPosterCore'
import { tenureView, joinFromAudit, parseSetDate } from '../lib/staffTenureCore'
import { selfReferralMatch, sameNormalisedName, type SelfReferralPerson } from '../lib/selfReferralCore'
import { taglineForbidden, TAGLINE_MAX, BIO_MAX, TAGLINE_SYSTEM } from '../lib/ai/taglineBrief'

const read = (p: string) => readFileSync(p, 'utf8')
const URDU = /[؀-ۿ]/

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(n)) out.push(p.replace(/\\/g, '/'))
  }
  return out
}

// ── Part B — poster controls ─────────────────────────────────────────────

test('poster tools: only the poster, or staff on a team-posted tuition', () => {
  const tutor = { isPoster: false, isAdmin: false, isTutor: true }
  const otherParent = { isPoster: false, isAdmin: false }
  const poster = { isPoster: true, isAdmin: false }
  const staff = { isPoster: false, isAdmin: true }
  assert.equal(posterToolsVisible(null, false), false, 'a visitor never sees them')
  assert.equal(posterToolsVisible(null, true), false)
  assert.equal(posterToolsVisible(tutor, false), false, 'a tutor never sees them')
  assert.equal(posterToolsVisible(tutor, true), false)
  assert.equal(posterToolsVisible(otherParent, false), false, 'another parent never sees them')
  assert.equal(posterToolsVisible(poster, false), true)
  assert.equal(posterToolsVisible(staff, true), true, 'staff/owner on a team post')
  assert.equal(posterToolsVisible(staff, false), false, "staff never on a parent's own tuition")
})

test('poster tools: the viewer route and page read the one rule', () => {
  const v = read('components/viewer/TuitionViewer.tsx')
  assert.match(v, /PosterOpenTools[\s\S]*posterToolsVisible\(v, v\.teamPost\)/)
  assert.match(v, /paused && posterToolsVisible\(v, v\.teamPost\)/)
  assert.ok(!/v\.isPoster \|\| v\.isAdmin/.test(v), 'the old any-admin check is gone')
  const r = read('app/api/viewer/tuition/route.ts')
  assert.match(r, /posterToolsVisible\(\{ isPoster, isAdmin \}, teamPost\)/)
  assert.match(r, /is_team_account/)
})

test('poster tools: the new wording and the greyed state', () => {
  assert.equal(REFRESH_BOX_TEXT, 'Move your tuition back to the top so more tutors see it. You can do this once every 3 days.')
  assert.equal(MOVE_TO_TOP_LABEL, 'Move to top')
  assert.equal(KEEP_OPEN_LABEL, 'Keep it open')
  assert.equal(keepOpenNotice(7), "Your tuition will be hidden in 7 days. Tap 'Keep it open' to show it for longer.")
  assert.equal(keepOpenNotice(1), "Your tuition will be hidden in 1 day. Tap 'Keep it open' to show it for longer.")
  const now = Date.parse('2026-11-02T10:00:00Z')
  assert.deepEqual(moveToTopState(null, now), { enabled: true, note: null })
  assert.deepEqual(moveToTopState(now - 1, now), { enabled: true, note: null })
  const later = Date.parse('2026-11-05T10:00:00Z')
  const st = moveToTopState(later, now)
  assert.equal(st.enabled, false)
  assert.equal(st.note, 'You can move it to the top again on 5 Nov 2026')
  assert.equal(nextMoveLine(later), st.note)
  assert.equal(moveToTopState(later, now, true).note, 'You can keep it open for longer again on 5 Nov 2026')
  const btn = read('app/(site)/tuitions/[city]/[slug]/RefreshInline.tsx')
  assert.match(btn, /disabled=\{busy \|\| !state\.enabled\}/, 'greyed, not an error after tapping')
  assert.match(btn, /bg-gray-200/)
  assert.ok(!/Refresh moves this tuition/.test(btn), 'old wording gone')
})

// ── Part C — Urdu ────────────────────────────────────────────────────────

test('no Urdu in API errors, auth/account messages or toasts', () => {
  for (const f of walk('app/api')) assert.ok(!URDU.test(read(f)), `Urdu left in ${f}`)
  for (const f of ['lib/authMessages.ts', 'lib/otp.ts', 'lib/rateLimit.ts', 'lib/errorMessages.ts', 'lib/selfPauseCore.ts', 'lib/parentGate.ts', 'lib/submit.ts', 'lib/gatedFetch.ts', 'lib/payments/receiptCore.ts', 'lib/jobs.ts', 'lib/tuitionMerge.ts', 'lib/docLockCore.ts', 'lib/gate.ts', 'components/ApplyReasonLine.tsx', 'components/account/ChangePasswordCard.tsx', 'components/ui/FriendlyPaymentError.tsx', 'components/AppErrorView.tsx', 'components/identity/DocLockNotice.tsx']) {
    assert.ok(!URDU.test(read(f)), `Urdu left in ${f}`)
  }
  // No toast call anywhere carries Urdu.
  for (const f of [...walk('app'), ...walk('components')]) {
    for (const line of read(f).split('\n')) {
      if (/toast\.(success|error)\(/.test(line)) assert.ok(!URDU.test(line), `Urdu in a toast: ${f}`)
    }
  }
})

test('the kept Urdu is unchanged', () => {
  assert.match(read('app/(site)/pay/choose/page.tsx'), /export const FEE_CARD_TITLE = 'تصدیق کروانا کیوں ضروری ہے؟'/)
  assert.match(read('app/(site)/pay/choose/PayChoice.tsx'), /<Ur>کسی بھی بینک ایپ، جاز کیش یا ایزی پیسہ سے اس اکاؤنٹ میں رقم بھیجیں/)
  assert.ok(URDU.test(read('lib/onboarding/copy.ts')), 'onboarding step labels keep Urdu')
  assert.ok(URDU.test(read('lib/templateUrdu.ts')), 'stored templates keep Urdu')
})

// ── Part D — Verified tuition ────────────────────────────────────────────

test('team-posted tuitions read "Verified tuition" on public cards and pages', () => {
  assert.equal(VERIFIED_TUITION_LABEL, 'Verified tuition')
  for (const f of ['components/JobCard.tsx', 'app/(site)/tuitions/[city]/[slug]/page.tsx']) {
    const s = read(f)
    assert.match(s, /\{VERIFIED_TUITION_LABEL\}/)
    assert.ok(!s.includes('TEAM_POSTER_LABEL'), `${f} must not show the poster label`)
    assert.ok(!s.includes(TEAM_POSTER_LABEL))
  }
  assert.match(read('components/JobCard.tsx'), /teamJob=\{!!job\.posted_by_team\}/, 'report stays "Problem with this job"')
})

// ── Part E — onboarding windows on a laptop ──────────────────────────────

test('onboarding windows: two columns, fixed button, fit 1366×768', () => {
  const shell = read('components/onboarding/StepShell.tsx')
  assert.match(shell, /lg:max-w-\[960px\]/)
  assert.match(shell, /fixed inset-x-0 z-20/, 'the main button stays fixed at the bottom')
  assert.match(shell, /lang="ur" dir="rtl" className="tm-ur-cap text-xl font-bold leading-snug/, 'Urdu heading the same size, tighter')
  // The CNIC window's Urdu opts out of the site-wide +18% Urdu bump.
  assert.equal((read('components/upgrade/TutorVerifyGate.tsx').match(/tm-ur-cap/g) ?? []).length, 4)
  assert.equal((read('components/identity/CnicCapture.tsx').match(/tm-ur-cap/g) ?? []).length, 3)
  const flow = read('components/tutor/NewOnboardingFlow.tsx')
  assert.equal((flow.match(/wide: true/g) ?? []).length, 3, 'photo, selfie and CNIC photos are wide')
  assert.equal((flow.match(/lg:grid lg:grid-cols-2/g) ?? []).length, 3)
  const gate = read('components/upgrade/TutorVerifyGate.tsx')
  assert.match(gate, /<CnicCapture onState=\{setCap\} hideChecklist split \/>/, 'no numbered step lines; number left, photos right')
  assert.ok(!gate.includes('ChecklistStatus'))
  assert.match(gate, /sticky bottom-0[\s\S]*data-cnic-buttons/, 'Not now / Verify fixed at the bottom')
  assert.match(gate, /Once verified, you can apply\.<\/span>/, 'green note is one line')
  assert.match(read('components/upgrade/UpgradeSheet.tsx'), /max-h-\[100dvh\][\s\S]*lg:max-w-3xl/)
  // Height budget at 768 px: header 110 + heading 60 + progress line 50 +
  // a CNIC side (label 20 + 456×(1/1.6) tile 285 + two 48 px buttons 104) +
  // the fixed button bar 72.
  assert.ok(110 + 60 + 50 + 20 + Math.round(456 / 1.6) + 104 + 72 <= 768)
})

// ── Part F — Tagline & About ─────────────────────────────────────────────

test('Tagline & About: limits, no prices, no superlatives', () => {
  assert.equal(TAGLINE_MAX, 120)
  assert.equal(BIO_MAX, 1000)
  assert.match(TAGLINE_SYSTEM, /any fee or price/)
  assert.match(TAGLINE_SYSTEM, /No superlatives/)
  const ok = { tagline: 'O Level Physics tutor in Lahore', bio: 'I teach O Level Physics at home and online.' }
  assert.equal(taglineForbidden(ok, {}), null)
  assert.equal(taglineForbidden({ ...ok, bio: 'My fee is Rs 5000 a month.' }, {}), 'mentions a price')
  assert.equal(taglineForbidden({ ...ok, tagline: 'The best Physics tutor in Lahore' }, {}), 'superlative')
  assert.equal(taglineForbidden({ ...ok, bio: 'x'.repeat(BIO_MAX + 1) }, {}), 'bio too long')
})

test('Tagline & About: tutor Settings tile and staff Edit tab, logged and revalidated', () => {
  const settings = read('app/(site)/tutor/dashboard/settings/page.tsx')
  assert.match(settings, /key: 'about'/)
  assert.match(settings, /<TaglineAboutEditor/)
  assert.ok(settings.indexOf("key: 'about'") > settings.indexOf('const step2Cards'), 'in Step 2 — Optional')
  assert.match(read('lib/tutorSettingsCopy.ts'), /title: \{ en: 'Tagline & About'/)
  const editor = read('components/tutor/TaglineAboutEditor.tsx')
  assert.match(editor, /Write it for me again/)
  assert.match(editor, /\/api\/tutor\/tagline/)
  assert.match(editor, /\/api\/profile\/save/)
  assert.match(read('app/api/profile/save/route.ts'), /TAGLINE_MAX[\s\S]*BIO_MAX/)
  const route = read('app/api/admin/tutors/edit/route.ts')
  assert.match(route, /action === 'set-about'/)
  assert.match(route, /reason\.length < 3/, 'reason required')
  assert.match(route, /recordFieldChanges\(changes\.map/, 'change history')
  assert.match(route, /await audit\(c\.field\)/, 'Audit')
  // logActivity (profile_updated) and logAdminAction rebuild the cached profile.
  assert.match(read('lib/activityLog.ts'), /revalidateTutorProfile\(params\.userId\)/)
  assert.match(read('lib/auditLog.ts'), /revalidateTutorProfile\(params\.targetId\)/)
  assert.match(read('app/admin/users/[id]/edit/TutorFieldEditor.tsx'), /postEdit\('set-about'/)
})

// ── Part G — joining dates ───────────────────────────────────────────────

test('joining dates from the audit log, role since, left, not recorded', () => {
  const audit = [
    { action: 'staff.role_change', createdAt: '2026-10-23T15:18:00Z', actorName: 'Alee Sabeer', detail: { to: 'supervisor', from: 'admin' } },
    { action: 'staff.grant_existing', createdAt: '2026-09-19T09:59:00Z', actorName: 'Alee Sabeer' },
  ]
  const j = joinFromAudit(audit)
  assert.deepEqual(j, { joinedAt: '2026-09-19T09:59:00Z', joinedByName: 'Alee Sabeer', source: 'staff.grant_existing' })
  const v = tenureView({ stored: null, audit, adminRole: 'supervisor', roleLabel: 'Manager', formerAt: null })
  assert.equal(v.joinedLine, 'Joined: 19 Sept 2026, 2:59 pm · added by Alee Sabeer'.replace('Sept', new Date('2026-09-19').toLocaleDateString('en-GB', { month: 'short', timeZone: 'Asia/Karachi' })))
  assert.match(v.roleSinceLine ?? '', /^Manager since 23 /)
  assert.equal(v.leftLine, null)
  const none = tenureView({ stored: null, audit: [], adminRole: 'tuitions_staff', roleLabel: 'Tuitions staff', formerAt: null })
  assert.equal(none.joinedLine, 'Joined: not recorded')
  assert.equal(none.joinedRecorded, false)
  const left = tenureView({ stored: j, audit, adminRole: null, roleLabel: null, formerAt: '2026-10-23T15:17:00Z' })
  assert.match(left.leftLine ?? '', /^Left: 23 /)
  const set = tenureView({ stored: { joinedAt: '2026-09-08T07:00:00Z', joinedByName: null, source: 'set' }, audit: [], adminRole: null, roleLabel: null, formerAt: null })
  assert.match(set.joinedLine, /date set by the Owner$/)
})

test('Set date: real past dates only, Pakistan time', () => {
  const now = Date.parse('2026-11-02T10:00:00Z')
  assert.equal(parseSetDate('2026-09-08', '12:00', now), '2026-09-08T07:00:00.000Z')
  assert.equal(parseSetDate('2026-09-08', '', now), '2026-09-08T07:00:00.000Z')
  assert.equal(parseSetDate('2026-02-30', '', now), null)
  assert.equal(parseSetDate('2027-01-01', '', now), null, 'not in the future')
  assert.equal(parseSetDate('8 Sep', '', now), null)
  const route = read('app/api/admin/team/joined/route.ts')
  assert.match(route, /adminRole !== 'owner'/)
  assert.match(route, /staff\.join_date_set/)
  assert.match(route, /already recorded and cannot be changed/)
})

test('Team cards show the lines; new staff get a stored joining date', () => {
  const client = read('app/admin/team/TeamClient.tsx')
  assert.match(client, /<TenureLines tenure=\{s\.tenure\}/)
  assert.match(client, /Former staff/)
  assert.match(client, /canSet=\{viewerRole === 'owner'\}/)
  const staff = read('lib/staff.ts')
  assert.match(staff, /recordStaffJoined\(userId, params\.actor\.id, 'staff\.create'\)/)
  assert.match(staff, /recordStaffJoined\(params\.userId, params\.actor\.id, 'staff\.grant_existing'\)/)
})

// ── Part H — self-referral ───────────────────────────────────────────────

const person = (p: Partial<SelfReferralPerson>): SelfReferralPerson => ({ name: null, phones: [], cnic: null, devices: [], ips: [], ...p })

test('self-referral: phone, CNIC, or name with the same device or IP', () => {
  const staff = person({ name: 'Khizra Danish', phones: ['03001234567'], cnic: '35202-1234567-1', devices: ['d1'], ips: ['i1'] })
  assert.deepEqual(selfReferralMatch(person({ phones: ['+92 300 1234567'] }), staff).reasons, ['same_phone'])
  assert.deepEqual(selfReferralMatch(person({ cnic: '3520212345671' }), staff).reasons, ['same_cnic'])
  // The 24 Oct example: a tutor called "Khizra" from the same device.
  assert.deepEqual(selfReferralMatch(person({ name: 'Khizra', devices: ['d1'] }), staff).reasons, ['same_name_device'])
  assert.deepEqual(selfReferralMatch(person({ name: 'khizra danish', ips: ['i1'] }), staff).reasons, ['same_name_ip'])
  assert.equal(selfReferralMatch(person({ name: 'Khizra' }), staff).match, false, 'a name alone never matches')
  assert.equal(selfReferralMatch(person({ name: 'Sara Khan', devices: ['d1'] }), staff).match, false, 'a shared device with another name is not a match')
  assert.equal(selfReferralMatch(person({ phones: ['03009999999'], cnic: '35202-7654321-1' }), staff).match, false)
  assert.equal(sameNormalisedName('Muhammad Ali', 'Ali'), true)
  assert.equal(sameNormalisedName('Al', 'Al Danish'), false, 'needs a word of 3+ letters')
})

test('self-referral: the credit goes to Admin with the reason logged', () => {
  const s = read('lib/staffSignups.ts')
  assert.match(s, /const self = await selfReferralFor\(admin, memberId, visit\.staffId\)/)
  assert.match(s, /action: 'staff\.signup_credit_refused'/)
  assert.match(s, /return creditDirect\(admin, memberId, SELF_REFERRAL_REFUSAL\)/)
  assert.match(read('app/api/auth/register/route.ts'), /deviceMarkFrom\(request\)/)
  assert.match(read('app/api/auth/register/verify/route.ts'), /deviceMarkFrom\(request\)/)
  assert.match(read('app/api/auth/login/route.ts'), /recordDeviceMark\(signedIn\.id, 'staff'/)
  const dm = read('lib/deviceMark.ts')
  assert.match(dm, /createHash\('sha256'\)/, 'only hashes are stored')
  assert.ok(!/console\.\w+\([^)]*(ip|anon)\b/.test(dm), 'never logs an IP or browser id')
})
