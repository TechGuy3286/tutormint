// scripts/test-staff-docs-names.ts — Backend Support approves documents, three
// new job types, Display name vs Name on CNIC (owner, 5 Nov 2026).
//   npm run test:staffdocsnames
// Pure rules plus source checks that the routes, screens and the database
// migration use them. The migration's own behaviour (backfill unchanged on
// screen, the CNIC-name lock, the Display-name trigger, tutor_profiles
// following) is proven against the live schema by
// scripts/apply-migration-224.ts in a rolled-back transaction.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  docDecider,
  staffDocRefusal,
  staffCardBlock,
  DOC_OWNER_ONLY,
  stateChangedSince,
  decisionChanged,
  staffDocDigest,
  DECISION_PROFILE_COLUMNS,
  type DecisionState,
} from '../lib/docDecisionCore'
import { SCREEN_ACCESS, roleSatisfies, type AdminRole } from '../lib/adminAccessCore'
import { adminNameLabel, cnicNameDiffers, cnicNameLocked, cnicNameProblem, displayNameProblem, effectiveName, DISPLAY_NAME_PROBLEMS } from '../lib/memberNamesCore'
import { nameEditDecision, nameOwnerOnly, OWNER_ONLY_NAME } from '../lib/nameEditCore'
import { shortJobTitle, PART_TIME_JOB_TITLES, keepKnownTitles } from '../lib/jobTitlesCore'
import { defaultEmploymentType } from '../lib/jobFieldsCore'
import { employmentTypeFor, jobPostingEmploymentType, jobPostingDescription } from '../lib/jobPostingCore'
import { postType, buildTuitionTitle } from '../lib/tuitionTitle'
import { jobDisplayTitle } from '../lib/jobDisplayTitle'
import { levelMismatch } from '../lib/tuitionTitleCheck'
import { matchVisibility } from '../lib/matchChip'
import { INTENT_WORDS } from '../lib/smartSearchCore'
import { namesPayload } from '../lib/editProfileSave'
import { PROFILE_FIELDS } from '../lib/profileSaveFields'
import { profileErasePatch } from '../lib/accountEraseCore'

const read = (p: string) => readFileSync(p, 'utf8')
const MONTESSORI = 'Montessori Expert'
const INTER = 'Intermediate Teacher (FA / FSc / ICS / I.Com)'
const GRAD = 'Graduation Level Teacher (BA / BSc / BS)'
const NEW_TYPES = [MONTESSORI, INTER, GRAD]

// ------------------------------------------------------------- Part A

const base = { decision: 'approve' as const, status: 'pending' as const, rereview: false, nameFlagged: false, nameMismatch: false, nameChecked: true }

test('Backend Support decides documents; other staff roles do not', () => {
  assert.equal(docDecider('owner'), 'owner')
  assert.equal(docDecider('backend_support'), 'staff')
  for (const r of ['admin', 'operations', 'partner', 'tuitions_staff', 'supervisor'] as AdminRole[]) assert.equal(docDecider(r), null, r)
  assert.equal(docDecider(null), null)
})

test('Backend Support may approve and reject a waiting CNIC, photo and selfie', () => {
  for (const item of ['cnic', 'profile_pic', 'selfie'] as const) {
    assert.equal(staffDocRefusal({ ...base, item }), null, `${item} approve`)
    assert.equal(staffDocRefusal({ ...base, item, decision: 'reject', nameChecked: false }), null, `${item} reject`)
  }
})

test('Backend Support may decide a re-uploaded photo or selfie (a re-review of an approved one)', () => {
  for (const item of ['profile_pic', 'selfie'] as const) {
    assert.equal(staffDocRefusal({ ...base, item, status: 'approved', rereview: true }), null)
    assert.equal(staffDocRefusal({ ...base, item, status: 'approved', rereview: true, decision: 'reject' }), null)
  }
})

test('the Owner-only cases are refused to Backend Support', () => {
  assert.equal(staffDocRefusal({ ...base, item: 'cnic', nameFlagged: true }), DOC_OWNER_ONLY.nameFlag)
  assert.equal(staffDocRefusal({ ...base, item: 'cnic', nameMismatch: true }), DOC_OWNER_ONLY.nameMismatch)
  assert.equal(staffDocRefusal({ ...base, item: 'cnic', decision: 'reject', nameMismatch: true }), DOC_OWNER_ONLY.nameMismatch)
  // Un-approving an approved document.
  for (const item of ['cnic', 'profile_pic', 'selfie'] as const) {
    assert.equal(staffDocRefusal({ ...base, item, status: 'approved', decision: 'reject' }), DOC_OWNER_ONLY.approved)
  }
  assert.equal(staffDocRefusal({ ...base, item: 'address' }), DOC_OWNER_ONLY.address)
  // A CNIC approval needs the name confirmed.
  assert.equal(staffDocRefusal({ ...base, item: 'cnic', nameChecked: false }), DOC_OWNER_ONLY.confirmName)
  // The name flag only concerns the CNIC.
  assert.equal(staffDocRefusal({ ...base, item: 'selfie', nameFlagged: true }), null)
  assert.equal(staffCardBlock({ item: 'cnic', status: 'pending', rereview: false, nameFlagged: true, nameMismatch: false }), DOC_OWNER_ONLY.nameFlag)
  assert.equal(staffCardBlock({ item: 'cnic', status: 'pending', rereview: false, nameFlagged: false, nameMismatch: false }), null)
})

test('unlocking and the CNIC number Show stay Owner-only; the list is the Owner’s', () => {
  assert.ok(read('app/api/admin/documents/unlock/route.ts').includes('refuseUnlessOwnerApproval'))
  assert.ok(read('app/api/admin/tutors/cnic-reveal/route.ts').length > 0)
  assert.deepEqual(SCREEN_ACCESS.staffDocDecisions, [])
  assert.ok(roleSatisfies('owner', SCREEN_ACCESS.staffDocDecisions))
  assert.ok(!roleSatisfies('backend_support', SCREEN_ACCESS.staffDocDecisions))
  assert.ok(!roleSatisfies('admin', SCREEN_ACCESS.staffDocDecisions))
  const undo = read('app/api/admin/documents/staff-decisions/route.ts')
  assert.ok(undo.includes('refuseUnlessOwnerApproval') && undo.includes('requireFreshAuth'))
})

test('both review routes go through the shared gate and record staff decisions', () => {
  for (const f of ['app/api/admin/tutors/document-review/route.ts', 'app/api/admin/parents/document-review/route.ts']) {
    const s = read(f)
    assert.ok(s.includes('beginDocDecision') && s.includes('finishDocDecision'), f)
    assert.ok(s.includes('SCREEN_ACCESS.documentDecide'), f)
  }
  const gate = read('lib/docDecisionGate.ts')
  assert.ok(gate.includes('refuseUnlessOwnerApproval') && gate.includes('staffDocRefusal') && gate.includes('recordStaffDecision'))
  assert.ok(gate.includes('alertOwnerBlocked'))
  assert.deepEqual(SCREEN_ACCESS.documentDecide, ['backend_support'])
})

const st = (profile: Record<string, unknown>, docs: Record<string, string> = {}): DecisionState => ({ profile, docs })

test('Undo returns the document to waiting, only when nothing changed since', () => {
  const before = st({ selfie_status: 'pending', selfie_reason: null }, { a: 'review', b: 'active' })
  const after = st({ selfie_status: 'approved', selfie_reason: null }, { a: 'active', b: 'paused' })
  assert.ok(decisionChanged(before, after))
  assert.ok(!decisionChanged(before, before), 'an idempotent repeat records nothing')
  assert.ok(!stateChangedSince(after, after))
  assert.ok(stateChangedSince(after, st({ selfie_status: 'rejected', selfie_reason: 'x' }, { a: 'active', b: 'paused' })), 'the Owner decided again')
  assert.ok(stateChangedSince(after, st({ selfie_status: 'approved', selfie_reason: null }, { a: 'paused', b: 'paused' })), 'a document moved')
  // Timestamps compare by instant.
  assert.ok(!stateChangedSince(st({ cnic_verified_at: '2026-11-05T10:00:00+00:00' }), st({ cnic_verified_at: '2026-11-05T10:00:00.000Z' })))
  // Undo restores the approval columns, so the badge that reads them goes.
  for (const col of ['verification_state', 'cnic_verified_at']) assert.ok(DECISION_PROFILE_COLUMNS.cnic.includes(col))
  for (const col of ['profile_pic_status', 'avatar_url', 'avatar_pending_url']) assert.ok(DECISION_PROFILE_COLUMNS.profile_pic.includes(col))
  assert.ok(DECISION_PROFILE_COLUMNS.selfie.includes('selfie_status'))
  const lib = read('lib/staffDocDecisions.ts')
  assert.ok(lib.includes("action: 'document.staff_decision_undo'"))
  assert.ok(lib.includes('undone_at'))
})

test('the daily bell line names each decision and links the filtered list', () => {
  const d = staffDocDigest(
    [
      { staffName: 'Aqsa', memberName: 'Zz Example', item: 'cnic', decision: 'approve' },
      { staffName: 'Aqsa', memberName: 'Yy Example', item: 'selfie', decision: 'reject' },
    ],
    '2026-11-04',
  )
  assert.match(d.title, /Documents approved by staff — 2 decisions \(2026-11-04\)/)
  assert.match(d.body, /Zz Example · CNIC approved · by Aqsa/)
  assert.match(d.body, /selfie rejected/)
  const lib = read('lib/staffDocDecisions.ts')
  assert.ok(lib.includes("kind: 'staff_documents_daily'") && lib.includes('/admin/documents/staff-decisions?day='))
  assert.ok(read('app/api/cron/subscriptions/route.ts').includes('notifyStaffDocDecisionsDaily'))
})

test('the review cards let Backend Support decide, with the name check on the CNIC', () => {
  for (const f of ['components/admin/TutorDocumentReview.tsx', 'components/admin/ParentDocumentReview.tsx']) {
    const s = read(f)
    assert.ok(s.includes('useDocDecider') && s.includes('staffCardBlock') && s.includes('CnicNameCheck') && s.includes('nameChecked'), f)
    assert.ok(s.includes('canDecide: canReviewProp && !readOnly && ownerApproves'), `${f}: changing a decided document stays the Owner's`)
  }
  assert.ok(read('app/admin/layout.tsx').includes('docDecider={docDecider(actor.adminRole)}'))
})

// ------------------------------------------------------------- Part B

test('the three new job types: titles, employment type, JobPosting', () => {
  assert.equal(shortJobTitle(INTER), 'Intermediate Teacher')
  assert.equal(shortJobTitle(GRAD), 'Graduation Level Teacher')
  assert.equal(shortJobTitle(MONTESSORI), MONTESSORI)
  assert.equal(postType(INTER, 'female'), 'Female Intermediate Teacher Required')
  assert.equal(buildTuitionTitle({ mode: MONTESSORI, gender: null, levels: ['Play Group'], area: 'Johar Town', city: 'Lahore' }), 'Montessori Expert Required | Play Group | Johar Town | Lahore')
  assert.equal(jobDisplayTitle({ jobType: GRAD, gender: null, level: null, area: null, city: 'Karachi' }), 'Graduation Level Teacher in Karachi')
  assert.equal(defaultEmploymentType(MONTESSORI), 'full_time')
  assert.equal(defaultEmploymentType(INTER), 'part_time')
  assert.equal(defaultEmploymentType(GRAD), 'part_time')
  assert.equal(jobPostingEmploymentType(null, MONTESSORI), 'FULL_TIME')
  assert.equal(jobPostingEmploymentType(null, INTER), 'PART_TIME')
  assert.equal(jobPostingEmploymentType(null, GRAD), 'PART_TIME')
  assert.equal(jobPostingEmploymentType('full_time', INTER), 'FULL_TIME', 'the stored value wins')
  assert.equal(employmentTypeFor({ jobTitle: INTER }), 'PART_TIME')
  assert.deepEqual([...PART_TIME_JOB_TITLES].sort(), [GRAD, INTER].sort())
  const desc = jobPostingDescription({ jobTitle: INTER, level: 'FSC Part I', subjects: ['Physics'], area: null, city: 'Lahore', timing: null, genderWord: null, budgetLabel: null })
  assert.match(desc, /^An Intermediate Teacher is required for FSC Part I/)
  assert.ok(!desc.includes('('))
})

test('the new job types: posting, Job type picker, filters (data-driven), search and matching', () => {
  // Posting, onboarding/Edit Profile Job type and both Browse filters read the
  // job_titles table; migration 224 inserts the three rows.
  const mig = read('supabase/migrations/224_staff_docs_job_types_two_names.sql')
  for (const t of NEW_TYPES) assert.ok(mig.includes(`'${t}'`), t)
  assert.deepEqual(keepKnownTitles([INTER, 'Not A Title'], NEW_TYPES), [INTER])
  for (const f of ['lib/jobTitles.ts', 'lib/jobTitlesServer.ts']) assert.ok(read(f).includes('job_titles'), f)
  // Search understanding.
  assert.equal((INTENT_WORDS['montessori'] as { mode: string }).mode, MONTESSORI)
  assert.equal((INTENT_WORDS['intermediate teacher'] as { mode: string }).mode, INTER)
  assert.equal((INTENT_WORDS['graduation level'] as { mode: string }).mode, GRAD)
  // Matching: a tutor who chose the same job type sees the tuition.
  assert.notEqual(matchVisibility(INTER, 'Lahore', [INTER], 'Lahore'), 'exclude')
  assert.equal(matchVisibility(INTER, 'Lahore', ['Home Tutor'], 'Lahore'), 'exclude')
  assert.notEqual(matchVisibility(MONTESSORI, 'Karachi', [MONTESSORI, 'Home Tutor'], 'Karachi'), 'exclude')
  // A level check knows them.
  assert.equal(levelMismatch(MONTESSORI, ['Play Group']), null)
  assert.ok(levelMismatch(MONTESSORI, ['O Levels']))
  assert.equal(levelMismatch(INTER, ['FSC Part I & Part II']), null)
})

// ------------------------------------------------------------- Part C

test('the shown name is the Display name, else the Name on CNIC', () => {
  assert.equal(effectiveName('Alee Sabeer', 'Sabir Ali'), 'Alee Sabeer')
  assert.equal(effectiveName('', 'Sabir Ali'), 'Sabir Ali')
  assert.equal(effectiveName(null, 'Sabir Ali'), 'Sabir Ali')
})

test('admin shows both names; only when they differ', () => {
  assert.equal(adminNameLabel('Alee Sabeer', 'Sabir Ali'), 'Alee Sabeer (CNIC: Sabir Ali)')
  assert.equal(adminNameLabel('Sabir Ali', 'sabir  ali'), 'Sabir Ali')
  assert.ok(!cnicNameDiffers('Sabir Ali', null))
  const member = read('app/admin/users/[id]/page.tsx')
  assert.ok(member.includes('Name on CNIC:') && member.includes('cnic_name'))
  assert.ok(read('components/admin/OverviewCardGrid.tsx').includes('CNIC: {m.cnicName}'))
  assert.ok(read('components/admin/CnicNameCheck.tsx').includes('Name on CNIC'))
})

test('the Display name check refuses impersonation, staff names and offensive words', () => {
  assert.equal(displayNameProblem(''), null, 'empty = use the Name on CNIC')
  assert.equal(displayNameProblem('Alee Sabeer'), null)
  assert.equal(displayNameProblem('TutorMint Official'), DISPLAY_NAME_PROBLEMS.impersonation)
  assert.equal(displayNameProblem('Tutor Mint'), DISPLAY_NAME_PROBLEMS.impersonation)
  assert.equal(displayNameProblem('Admin Ali'), DISPLAY_NAME_PROBLEMS.impersonation)
  assert.equal(displayNameProblem('Support Team'), DISPLAY_NAME_PROBLEMS.impersonation)
  assert.equal(displayNameProblem('Aqsa Mughal', { staffNames: ['Aqsa Mughal'] }), DISPLAY_NAME_PROBLEMS.staff)
  assert.equal(displayNameProblem('Aqsa Mughal', { staffNames: ['Aqsa Mughal'], ownNames: ['Aqsa Mughal'] }), null)
  assert.equal(displayNameProblem('Harami Khan'), DISPLAY_NAME_PROBLEMS.offensive)
  assert.equal(displayNameProblem('Sexton'), null, 'whole words only')
  assert.equal(displayNameProblem('A1'), DISPLAY_NAME_PROBLEMS.chars)
  assert.equal(displayNameProblem('x'.repeat(61)), DISPLAY_NAME_PROBLEMS.long)
  assert.equal(cnicNameProblem('M'), 'Write your name exactly as it is on your CNIC.')
  assert.equal(cnicNameProblem('Muhammad Ali'), null)
})

test('the Name on CNIC is locked after CNIC approval; staff change it, Owner-only once approved', () => {
  assert.ok(cnicNameLocked({ cnic_verified_at: '2026-11-01T00:00:00Z' }))
  assert.ok(cnicNameLocked({ verification_state: 'approved' }))
  assert.ok(!cnicNameLocked({ verification_state: 'submitted' }))
  const t = { role: 'tutor', cnicVerifiedAt: '2026-11-01', fullName: 'Sabir Ali' }
  assert.ok(nameOwnerOnly(t, 'cnic'))
  assert.ok(!nameOwnerOnly(t, 'display'))
  assert.ok(!nameOwnerOnly({ role: 'parent', cnicVerifiedAt: '2026-11-01' }, 'cnic'), 'a parent’s stays with staff')
  const refused = nameEditDecision({ actorRole: 'admin', target: t, name: 'Other Name', reason: 'fix', field: 'cnic' })
  assert.deepEqual(refused, { ok: false, status: 403, error: OWNER_ONLY_NAME })
  assert.equal(nameEditDecision({ actorRole: 'owner', target: t, name: 'Other Name', reason: 'fix', field: 'cnic' }).ok, true)
  assert.equal(nameEditDecision({ actorRole: 'admin', target: t, name: 'Alee Sabeer', reason: 'asked', field: 'display' }).ok, true)
  const bad = nameEditDecision({ actorRole: 'admin', target: t, name: 'TutorMint', reason: 'asked', field: 'display' })
  assert.equal(bad.ok, false)
  const reasonNeeded = nameEditDecision({ actorRole: 'owner', target: t, name: 'X Y', reason: '', field: 'display' })
  assert.equal(reasonNeeded.ok, false)
  // The database lock (migration 224) and the routes.
  const mig = read('supabase/migrations/224_staff_docs_job_types_two_names.sql')
  assert.ok(mig.includes('To change your Name on CNIC, please contact our support.'))
  assert.ok(read('app/api/profile/save/route.ts').includes('cnicNameLocked'))
  assert.ok(read('app/api/parent/profile/route.ts').includes('cnicNameLocked'))
  const route = read('app/api/admin/members/name/route.ts')
  assert.ok(route.includes("'member.cnic_name_edit'") && route.includes("'member.display_name_edit'"))
})

test('the CNIC name is never public: public readers use the shown name; full_name is derived', () => {
  // full_name is derived in the database: the Display name, else the Name on CNIC.
  const mig = read('supabase/migrations/224_staff_docs_job_types_two_names.sql')
  assert.ok(mig.includes("new.full_name := coalesce(nullif(btrim(new.display_name), ''), nullif(btrim(new.cnic_name), ''), new.full_name)"))
  assert.ok(mig.includes('update public.tutor_profiles set full_name = new.full_name'))
  // Backfill copies the current name into both.
  assert.ok(mig.includes('set cnic_name = coalesce(cnic_name, full_name)') && mig.includes('display_name = coalesce(display_name, full_name)'))
  // No public surface selects cnic_name.
  const publicFiles = [
    'app/(site)/tutor/[slug]/profile.tsx',
    'lib/browseTutors.ts',
    'lib/jobFeed.ts',
    'lib/publicParent.ts',
    'lib/seo.ts',
    'lib/social/postTutor.ts',
    'lib/social/data.ts',
    'lib/cv/build.ts',
    'app/og/tutor/[slug]/route.tsx',
    'lib/messaging.ts',
  ]
  for (const f of publicFiles) assert.ok(!read(f).includes('cnic_name'), `${f} must not read the Name on CNIC`)
})

test('Edit Profile and onboarding save both names through the checked route', () => {
  assert.ok(PROFILE_FIELDS.has('cnic_name') && PROFILE_FIELDS.has('display_name'))
  assert.deepEqual(namesPayload({ cnicName: 'Sabir Ali', displayName: 'Alee', cnicNameLocked: false }), { profile: { display_name: 'Alee', cnic_name: 'Sabir Ali' } })
  assert.deepEqual(namesPayload({ cnicName: 'Sabir Ali', displayName: '', cnicNameLocked: true, whatsapp: '923001234567' }), { profile: { display_name: '', whatsapp: '923001234567' } })
  const tutorSettings = read('app/(site)/tutor/dashboard/settings/page.tsx')
  assert.ok(tutorSettings.includes('Name on CNIC') && tutorSettings.includes('Display name (shown to parents and tutors)'))
  assert.ok(!tutorSettings.includes(".update({ full_name:"), 'no direct name write from the browser')
  const parentSettings = read('app/(site)/parent/dashboard/settings/SettingsClient.tsx')
  assert.ok(parentSettings.includes('Name on CNIC') && parentSettings.includes('Display name (shown to parents and tutors)'))
  const flow = read('components/tutor/CompleteProfileFlow.tsx')
  assert.ok(flow.includes('NamesStep') && flow.includes('cnic_name: cnic') && flow.includes('display_name: display'))
  assert.ok(read('app/(site)/parent/verify/page.tsx').includes('label="Name on CNIC"'))
  assert.ok(read('app/api/profile/save/route.ts').includes('displayNameRefusal'))
})

test('erasing an account clears both names', () => {
  const p = profileErasePatch('00000000-0000-0000-0000-000000000000', '2026-11-05T00:00:00Z')
  assert.equal(p.cnic_name, null)
  assert.equal(p.display_name, null)
  assert.equal(p.full_name, 'Deleted user')
})
