/**
 * scripts/test-consent.ts — parent consent for listings, team-posted tuition
 * labels, report fixes, the /pay/choose Submit button and tutor addresses in
 * the review list (owner, 27 Oct 2026). Invented data only; nothing here
 * touches the database.
 *
 *   npm run test:consent
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'

import {
  CONSENT_ASK_DEFAULT,
  CONSENT_METHOD_ERROR,
  CONSENT_REQUIRED_ERROR,
  CONSENT_TICK_LABEL,
  HIDDEN_REVEAL_ERROR,
  consentFromImportCell,
  consentInputProblem,
  consentLabel,
  consentPercentLabel,
  fillConsentAsk,
  importRowConsent,
  numberHidden,
  parseHideSwitch,
} from '../lib/tuitionConsentCore'
import {
  JOB_PROBLEM_LABEL,
  JOB_PROBLEM_REASONS,
  TEAM_MEMBER_NAME,
  TEAM_POSTER_LABEL,
  jobReportDecision,
  memberDisplayName,
  reportReasonLabel,
  reportReasonsFor,
} from '../lib/teamPosterCore'
import { forwardStatus, reporterApplicationLines, reporterStatusLine, tuitionLinkText } from '../lib/reportCardCore'
import { countConsent, postingWindows, sumRows, emptyPostingCounts } from '../lib/tuitionPostingCore'
import { maskTuitionText } from '../lib/maskTuition'
import { jobPostingJsonLd } from '../lib/seo'
import { ToastProvider } from '../components/ui/Toast'
import { ConfirmProvider } from '../components/ui/ConfirmDialog'
import { AdminReadOnlyProvider } from '../components/admin/ReadOnly'
import PostTuitionForm from '../components/forms/PostTuitionForm'
import ConsentChip from '../components/admin/ConsentChip'
import ReportTargetBlock from '../components/admin/ReportTargetBlock'
import ReportButton from '../components/ReportButton'
import JobCard, { type JobCardData } from '../components/JobCard'
import ParentDocumentReview from '../components/admin/ParentDocumentReview'
import PayChoice, { SUBMIT_LABEL, submitButtonClass } from '../app/(site)/pay/choose/PayChoice'

const read = (p: string) => readFileSync(p, 'utf8')
const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }
const render = (node: ReactNode, opts: { readOnly?: boolean; canApprove?: boolean } = {}) =>
  renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router as never },
      createElement(
        ToastProvider,
        null,
        createElement(
          ConfirmProvider,
          null,
          createElement(AdminReadOnlyProvider, { readOnly: opts.readOnly ?? false, refCode: null, canApprove: opts.canApprove ?? false, children: node }),
        ),
      ),
    ),
  )

// ── Part A.1/A.2 — consent required on staff posting and admin edit ──────

test('consent: the tick AND a method are required; parent_posted is never a staff choice', () => {
  assert.equal(consentInputProblem({ agreed: false, method: 'phone' }), CONSENT_REQUIRED_ERROR)
  assert.equal(consentInputProblem({ agreed: true, method: '' }), CONSENT_METHOD_ERROR)
  assert.equal(consentInputProblem({ agreed: true, method: 'parent_posted' }), CONSENT_METHOD_ERROR)
  assert.equal(consentInputProblem({ agreed: true, method: 'phone' }), null)
  assert.equal(consentInputProblem({ agreed: true, method: 'whatsapp' }), null)
  assert.equal(consentInputProblem({ agreed: true, method: 'in_person' }), null)
  assert.equal(consentLabel({ status: 'recorded', method: 'phone' }), 'Recorded — Phone call')
  assert.equal(consentLabel({ status: 'recorded', method: 'parent_posted' }), 'Recorded — Parent posted it themselves')
  assert.equal(consentLabel({ status: 'not_recorded', method: null }), 'Not recorded')
  assert.equal(consentLabel(null), 'Not recorded')
})

test('consent: createTeamJob and updateTeamJob refuse BEFORE anything is written, and record it after', () => {
  const jobs = read('lib/jobs.ts')
  const create = jobs.slice(jobs.indexOf('export async function createTeamJob('), jobs.indexOf('export async function updateTeamJob('))
  const update = jobs.slice(jobs.indexOf('export async function updateTeamJob('), jobs.indexOf('export async function updateJob('))
  for (const [name, body] of [['create', create], ['update', update]] as const) {
    const check = body.indexOf('consentInputProblem(')
    assert.ok(check > 0, `${name} checks consent`)
    const firstWrite = body.search(/\.(insert|update|upsert)\(/)
    assert.ok(check < firstWrite, `${name}: consent is checked before the first write`)
    assert.match(body, /recordConsent\(actor, /, `${name} records the consent`)
  }
  // Both routes pass the fields through.
  for (const f of ['app/api/admin/jobs/create/route.ts', 'app/api/admin/jobs/[id]/route.ts']) {
    const src = read(f)
    assert.match(src, /consentAgreed: z\.boolean\(\)\.optional\(\)/)
    assert.match(src, /consentAgreed: body\.consentAgreed === true/)
  }
})

// Superseded later on 27 Oct 2026: consent is no longer needed, so the box is
// hidden on both forms (CONSENT_UI_ENABLED off). The edit page still loads a
// recorded consent, and the data is kept.
test('consent: the tick + method are hidden on the staff form and the parent form', () => {
  const noop = async () => ({ ok: true as const })
  const admin = render(createElement(PostTuitionForm, { teamBanner: true, adminExtras: true, submitLabel: 'Post', busyLabel: '…', onSubmit: noop }))
  const parent = render(createElement(PostTuitionForm, { submitLabel: 'Post', busyLabel: '…', onSubmit: noop }))
  assert.ok(!admin.includes(CONSENT_TICK_LABEL))
  assert.ok(!admin.includes('data-consent-box'))
  assert.ok(!parent.includes(CONSENT_TICK_LABEL))
  // The edit page pre-ticks a recorded consent.
  assert.match(read('app/admin/jobs/[id]/edit/page.tsx'), /consentAgreed: !!staffMethod/)
})

test('bulk import: a row without a consent column, or with an empty one, is Not recorded', () => {
  assert.deepEqual(importRowConsent({ name: 'x', mobile: '0300' }), { status: 'not_recorded', method: null })
  assert.deepEqual(importRowConsent({ Consent: '' }), { status: 'not_recorded', method: null })
  assert.deepEqual(importRowConsent({ Consent: 'maybe' }), { status: 'not_recorded', method: null })
  assert.deepEqual(importRowConsent({ 'Parent Consent': 'WhatsApp' }), { status: 'recorded', method: 'whatsapp' })
  assert.deepEqual(consentFromImportCell('YES'), { status: 'recorded', method: 'phone' })
  assert.deepEqual(consentFromImportCell('In person'), { status: 'recorded', method: 'in_person' })
})

test('migration 208: parent posts recorded (parent posted it themselves), staff posts not recorded, new rows by trigger', () => {
  const sql = read('supabase/migrations/208_tuition_consent.sql')
  assert.match(sql, /create table if not exists public\.tuition_consents/)
  assert.match(sql, /for select using \(public\.is_admin\(\)\)/)
  assert.match(sql, /when coalesce\(p\.is_team_account, false\) then 'not_recorded' else 'recorded'/)
  assert.match(sql, /after insert on public\.jobs/)
  assert.match(sql, /'privacy\.hide_unconsented_numbers', 'true'/)
  assert.match(sql, /constraint tuition_consents_method_when_recorded check \(\(status = 'recorded'\) = \(method is not null\)\)/)
})

// ── Part A.3 — the chip and "Ask parent" ─────────────────────────────────

test('chip: "Consent not recorded" with Ask parent and Parent agreed; recorded shows the method', () => {
  const nr = render(createElement(ConsentChip, { jobId: '00000000-0000-4000-8000-000000000001', recorded: false, hasNumber: true }), { canApprove: true })
  assert.ok(nr.includes('Consent not recorded'))
  assert.ok(nr.includes('Ask parent'))
  assert.ok(nr.includes('/api/admin/jobs/consent/ask?jobId=00000000-0000-4000-8000-000000000001'))
  assert.ok(nr.includes('Parent agreed'))
  assert.ok(nr.includes('/admin/withdraw-contact'), 'the Owner gets the Withdraw a contact link')
  const staff = render(createElement(ConsentChip, { jobId: '00000000-0000-4000-8000-000000000001', recorded: false }))
  assert.ok(!staff.includes('/admin/withdraw-contact') && staff.includes('Ask the Owner to withdraw the contact'))
  const ro = render(createElement(ConsentChip, { jobId: 'x', recorded: false }), { readOnly: true })
  assert.ok(ro.includes('Consent not recorded') && !ro.includes('Ask parent'), 'view only: no actions')
  const rec = render(createElement(ConsentChip, { jobId: 'x', recorded: true, label: 'Recorded — WhatsApp' }))
  assert.ok(rec.includes('Recorded — WhatsApp') && !rec.includes('Ask parent'))
  // Both places show it.
  assert.match(read('app/admin/jobs/JobRow.tsx'), /<ConsentChip jobId=\{row\.id\}/)
  assert.match(read('app/admin/applications/ApplicationsClient.tsx'), /<ConsentChip jobId=\{key\}/)
})

test('Ask parent: the default message is the owner’s exact text, plain English, no price', () => {
  assert.equal(
    CONSENT_ASK_DEFAULT,
    "Assalam o Alaikum, we'd like to list your tuition requirement on TutorMint so verified tutors can apply. May we list it? Please reply YES or NO.",
  )
  assert.doesNotMatch(CONSENT_ASK_DEFAULT, /Rs|PKR|\d/)
  assert.match(read('supabase/migrations/208_tuition_consent.sql'), /we\\'d like to list your tuition requirement on TutorMint so verified tutors can apply\. May we list it\? Please reply YES or NO\./)
  // Placeholders fill; a number or email in a filled value never rides along.
  assert.equal(fillConsentAsk('Hi {parent_name}, {tm_number}', { parentName: 'Sana 03001234567', tmNumber: 'TM-1' }), 'Hi Sana, TM-1')
  // The template is kept but inactive since 27 Oct 2026 (migration 210): its
  // group is no longer shown in Team inbox → Templates.
  assert.match(read('lib/templateRules.ts'), /CONSENT_GROUP/)
  assert.doesNotMatch(read('app/admin/inbox/InboxClient.tsx'), /group="consent"/)
})

// ── Part A.4 — the Owner's switch hides numbers everywhere ───────────────

test('switch: OFF by default (hotfix, owner 27 Oct 2026); missing or unreadable reads OFF; on only when it says on', () => {
  assert.equal(parseHideSwitch(null), false)
  assert.equal(parseHideSwitch(''), false)
  assert.equal(parseHideSwitch('garbage'), false)
  assert.equal(parseHideSwitch('false'), false)
  assert.equal(parseHideSwitch('off'), false)
  assert.equal(parseHideSwitch('true'), true)
  assert.equal(parseHideSwitch('on'), true)
  const lib = read('lib/tuitionConsent.ts')
  const fn = lib.slice(lib.indexOf('export const hideNumbersSwitchOn'), lib.indexOf('/** Consent for each tuition'))
  assert.doesNotMatch(fn, /return true/, 'no path reads the switch as ON by accident')
  // Migration 209 turns it off and writes the Audit row.
  const m = read('supabase/migrations/209_hide_numbers_off.sql')
  assert.match(m, /set value = 'false'/)
  assert.match(m, /Turned off at the owner''s request/)
})

test('switch OFF: every tuition reveals — not recorded, missing row and recorded alike', () => {
  for (const c of [{ status: 'not_recorded' as const }, null, undefined, { status: 'recorded' as const }]) {
    assert.equal(numberHidden(false, c), false)
    assert.equal(numberHidden(parseHideSwitch(null), c), false, 'the default reveals')
  }
})

test('switch ON hides a not-recorded tuition; OFF restores behaviour; recorded is never hidden', () => {
  assert.equal(numberHidden(true, { status: 'not_recorded' }), true)
  assert.equal(numberHidden(true, null), true, 'a missing row is the safe side')
  assert.equal(numberHidden(true, { status: 'recorded' }), false)
  assert.equal(numberHidden(false, { status: 'not_recorded' }), false, 'switch off: shown as before')
  assert.equal(numberHidden(false, null), false)
})

test('switch: the reveal, earlier reveals and the reveal status all check consent; no reveal is counted', () => {
  const src = read('lib/contactReveal.ts')
  const reveal = src.slice(src.indexOf('export async function revealJobContact('), src.indexOf('export async function peekTuitionContact('))
  const hiddenAt = reveal.indexOf('numberHiddenFor(jobId)')
  assert.ok(hiddenAt > 0)
  assert.ok(hiddenAt < reveal.indexOf('spendTuitionPool('), 'refused before any spend')
  assert.ok(hiddenAt < reveal.indexOf('tutorGate('), 'refused before every other check')
  const peek = src.slice(src.indexOf('export async function peekTuitionContact('), src.indexOf('// ── shared tails'))
  assert.ok(peek.indexOf('numberHiddenFor(jobId)') > 0 && peek.indexOf('numberHiddenFor(jobId)') < peek.indexOf('loadTuitionTarget('), 'an earlier reveal is hidden too')
  const status = src.slice(src.indexOf('export async function jobContactRevealStatus('), src.indexOf('export async function revealJobContact('))
  assert.match(status, /reason: 'consent'/)
  // The card and page data drop the teaser and show the line instead.
  const feed = read('lib/jobFeed.ts')
  assert.match(feed, /const contactTeaser = contactHidden \? null :/)
  const page = read('app/(site)/tuitions/[city]/[slug]/page.tsx')
  assert.doesNotMatch(page, /job\.contactHidden && \(/, 'no hidden-contact line is drawn (hotfix)')
  assert.match(page, /!job\.contactHidden && job\.contactTeaser/)
  assert.match(page, /!job\.contactHidden && <ContactReveal/)
  // Only the Owner changes the switch; every change is logged.
  const route = read('app/api/admin/settings/hide-numbers/route.ts')
  assert.match(route, /SCREEN_ACCESS\.consentPrivacy/)
  assert.match(route, /adminRole !== 'owner'/)
  assert.match(route, /requireFreshAuth/)
  assert.match(read('lib/tuitionConsent.ts'), /action: 'settings\.hide_unconsented_numbers'/)
})

test('switch ON: a tutor’s card shows no number and no consent line; OFF: the teaser is back', () => {
  const base: JobCardData = {
    id: '00000000-0000-4000-8000-000000000002',
    job_tx_id: 'JOB-X',
    ref_id: 'TM-9999',
    public_slug: 'home-tutor-required-abc123',
    status: 'open',
    title: 'Home Tutor for Grade 5 in DHA, Lahore',
    headline: 'Home Tutor Required | Grade 5 | DHA | Lahore',
    description: 'Maths and English, evenings.',
    subjects: ['Mathematics'],
    class_level: 'Grade 5',
    city: 'Lahore',
    area: 'DHA',
    teaching_mode: 'Home Tutor',
    budget_pkr: null,
    created_at: '2026-10-26T08:00:00Z',
    parent_id: '00000000-0000-4000-8000-000000000003',
    parent_name: null,
    parent_badges: [],
    parent_can_hire: false,
    posted_by_team: true,
    contactTeaser: '0300 •••••••',
  } as unknown as JobCardData
  const hidden = render(createElement(JobCard, { job: { ...base, contactTeaser: null, contactHidden: true }, signedIn: true, showApply: true }))
  assert.ok(!hidden.includes('0300'), 'no number at all')
  assert.ok(!hidden.includes('View number'))
  const shown = render(createElement(JobCard, { job: base, signedIn: true, showApply: true }))
  assert.ok(shown.includes('View number'))
  for (const html of [hidden, shown]) assert.doesNotMatch(html, CONSENT_WORDING, 'no consent wording on a tutor card, whatever the setting')
})

// Tutors and the public are never told anything about consent (hotfix, owner 27 Oct 2026).
const CONSENT_WORDING = /consent|share your profile|agreed to be listed/i

test('no consent wording on tutor or public pages, whatever the setting', () => {
  for (const f of [
    'components/JobCard.tsx',
    'app/(site)/tuitions/[city]/[slug]/page.tsx',
    'components/ContactReveal.tsx',
  ]) {
    assert.doesNotMatch(read(f), /share your profile|HIDDEN_CONTACT_LINE|agreed to be listed/i, f)
  }
  assert.doesNotMatch(HIDDEN_REVEAL_ERROR, CONSENT_WORDING)
  // No string in app/(site) or components (outside admin) says it.
  let hits = ''
  try {
    hits = execSync('git grep -n -i "share your profile with the parent" -- "app/(site)" components ":!components/admin"', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    hits = '' // git grep exits 1 when nothing matches
  }
  assert.equal(hits.trim(), '')
})

// ── public pages never show a parent number ──────────────────────────────

test('public pages: the description is masked and JobPosting carries no number', () => {
  const masked = maskTuitionText('Call 0300 1234567 or 0321-7654321 for details').text
  assert.doesNotMatch(masked, /1234567|7654321/)
  const ld = JSON.stringify(
    jobPostingJsonLd({
      title: 'Home Tutor Required',
      description: masked,
      url: 'https://www.tutormint.org/tuitions/lahore/x-abc123',
      city: 'Lahore',
      area: 'DHA',
      subjects: ['Mathematics'],
      datePosted: '2026-10-26T08:00:00Z',
      validThrough: '2026-11-15T08:00:00Z',
      budgetMin: null,
      budgetMax: null,
      refId: 'TM-9999',
    }),
  )
  // Only the 4-digit operator prefix survives the mask (the existing teaser design); never the number.
  assert.doesNotMatch(ld, /1234567|7654321|03001234567|923001234567/)
  // The public page never reads the contact tables itself.
  const page = read('app/(site)/tuitions/[city]/[slug]/page.tsx')
  assert.doesNotMatch(page, /from\('job_contacts'\)|import \{[^}]*loadJobContact/)
  assert.doesNotMatch(read('components/JobCard.tsx'), /from\('job_contacts'\)|loadJobContact/)
})

// ── Part B.6 — "Posted by TutorMint team for a parent ✓" ─────────────────

test('label: staff-posted tuitions read the label, never the team account’s own name', () => {
  assert.equal(TEAM_POSTER_LABEL, 'Posted by TutorMint team for a parent ✓')
  assert.equal(memberDisplayName('TutorMint Admin', true), TEAM_MEMBER_NAME)
  assert.equal(memberDisplayName('Sana Khan', false), 'Sana Khan')
  const card = render(
    createElement(JobCard, {
      job: {
        id: 'j', job_tx_id: 'J', ref_id: 'TM-1', public_slug: 's-abc123', status: 'open', title: 'Home Tutor in Lahore', headline: 'Home Tutor',
        description: null, subjects: [], class_level: null, city: 'Lahore', area: null, teaching_mode: 'Home Tutor', budget_pkr: null,
        created_at: '2026-10-26T08:00:00Z', parent_id: 'p', parent_name: 'TutorMint', parent_badges: [], parent_can_hire: true, posted_by_team: true,
      } as unknown as JobCardData,
    }),
  )
  assert.ok(card.includes('Posted by TutorMint team for a parent ✓'))
  assert.ok(!card.includes('TutorMint Admin'))
  assert.match(read('app/(site)/tuitions/[city]/[slug]/page.tsx'), /\{TEAM_POSTER_LABEL\}/)
  // Messages and reports use the team name, never full_name, for the team account.
  const msg = read('lib/messaging.ts')
  assert.equal((msg.match(/is_team_account \? TEAM_MEMBER_NAME/g) ?? []).length + (msg.match(/\?\.is_team_account \? TEAM_MEMBER_NAME/g) ?? []).length >= 3, true)
  assert.match(read('lib/adminQueues.ts'), /p\.is_team_account \? TEAM_MEMBER_NAME/)
  assert.match(read('components/messages/InboxShell.tsx'), /otherIsTeam && <span[^>]*>\{TEAM_POSTER_LABEL\}/)
})

// ── Part B.7 — "Problem with this job" ───────────────────────────────────

test('reports: a staff-posted tuition offers the four job reasons, no "Fake profile", and names nobody', () => {
  assert.deepEqual(
    JOB_PROBLEM_REASONS.map((r) => r.label),
    ['No response from the parent', 'Already filled', 'Wrong details', 'Something else'],
  )
  assert.ok(!reportReasonsFor(true).some((r) => r.code === 'fake_profile'))
  assert.ok(reportReasonsFor(false).some((r) => r.code === 'fake_profile'))
  assert.deepEqual(jobReportDecision({ teamJob: true, reason: 'job_already_filled', reportedId: 'team-id' }), { ok: true, reportedId: null })
  assert.equal(jobReportDecision({ teamJob: true, reason: 'fake_profile', reportedId: 'team-id' }).ok, false)
  assert.equal(jobReportDecision({ teamJob: false, reason: 'job_wrong_details', reportedId: 'p' }).ok, false)
  assert.deepEqual(jobReportDecision({ teamJob: false, reason: 'spam', reportedId: 'p' }), { ok: true, reportedId: 'p' })
  assert.equal(reportReasonLabel('job_no_response'), 'Problem with this job: no response from the parent')
  const btn = render(createElement(ReportButton, { reportedId: null, targetType: 'job', targetId: 'j', teamJob: true }))
  assert.ok(btn.includes(JOB_PROBLEM_LABEL))
  // The route decides "staff-posted" from the row, never from the request.
  const route = read('app/api/reports/route.ts')
  assert.match(route, /jobReportDecision\(\{ teamJob: await isTeamJob\(body\.targetId\)/)
  assert.match(route, /reported_id: reportedId,/)
  assert.match(read('supabase/migrations/208_tuition_consent.sql'), /update public\.reports r\s+set reported_id = null/)
})

// ── Part B.8 — report cards link the exact item ──────────────────────────

test('report cards: the exact tuition (TM number + title), the reporter’s status and their application', () => {
  const html = render(
    createElement(ReportTargetBlock, {
      target: {
        kind: 'tuition', jobId: 'j1', refId: 'TM-1234', title: 'Home Tutor Required | Grade 5 | DHA | Lahore',
        adminHref: '/admin/jobs/j1', publicHref: '/tuitions/lahore/home-tutor-required-abc123', postedByTeam: true,
      },
      reporter: { role: 'tutor', feePaid: true, verified: true, mobileVerified: true },
      applications: [{ stage: 'forwarded', appliedAt: '2026-10-26T08:00:00Z', withdrawn: false }],
    }),
  )
  assert.ok(html.includes('href="/admin/jobs/j1"'))
  assert.ok(html.includes('TM-1234 · Home Tutor Required | Grade 5 | DHA | Lahore'))
  assert.ok(html.includes('href="/tuitions/lahore/home-tutor-required-abc123"'))
  assert.ok(html.includes('Tutor · Fee paid · Verified badge'))
  assert.ok(html.includes('Stage: Forwarded · Forwarded to the parent'))
  const profile = render(
    createElement(ReportTargetBlock, {
      target: { kind: 'profile', memberId: 'm1', name: 'Rida Saeed', adminHref: '/admin/users/m1', publicHref: '/tutor/rida-saeed-tutor' },
      reporter: { role: 'parent', feePaid: false, verified: false, mobileVerified: true },
      applications: [],
    }),
  )
  assert.ok(profile.includes('href="/admin/users/m1"') && profile.includes('href="/tutor/rida-saeed-tutor"'))
  assert.ok(profile.includes('Parent · Mobile verified'))
  assert.equal(tuitionLinkText(null, 'X'), 'X')
  assert.equal(forwardStatus('applied'), 'Not forwarded yet')
  assert.deepEqual(reporterApplicationLines([{ stage: 'applied', appliedAt: 'x', withdrawn: true }], () => ''), [], 'withdrawn applications are not open')
  assert.equal(reporterStatusLine(null), 'Account no longer available')
  assert.match(read('app/admin/reports/ReportQueue.tsx'), /<ReportTargetBlock target=\{r\.target\}/)
})

// ── Part A.5 — Team activity "Consent recorded" ──────────────────────────

test('Team activity: consent % for the last 7 days and all time, summed in the Team total', () => {
  const now = Date.parse('2026-10-27T06:00:00Z')
  const w = postingWindows(now)
  const c = countConsent(
    [
      { at: Date.parse('2026-10-26T08:00:00Z'), recorded: true },
      { at: Date.parse('2026-10-25T08:00:00Z'), recorded: false },
      { at: Date.parse('2026-09-01T08:00:00Z'), recorded: true },
      { at: Date.parse('2026-09-02T08:00:00Z'), recorded: false },
    ],
    w,
  )
  assert.deepEqual(c, { last7: { recorded: 1, total: 2 }, allTime: { recorded: 2, total: 4 } })
  assert.equal(consentPercentLabel(c.last7), '50% (1 of 2)')
  assert.equal(consentPercentLabel({ recorded: 0, total: 0 }), '—')
  const total = sumRows(
    [
      { id: 'a', name: 'A', counts: emptyPostingCounts(), repeats: 0, consent: c },
      { id: 'b', name: 'B', counts: emptyPostingCounts(), repeats: 0, consent: c },
    ],
    't',
    'Team total',
  )
  assert.deepEqual(total.consent, { last7: { recorded: 2, total: 4 }, allTime: { recorded: 4, total: 8 } })
})

// ── Part C — /pay/choose ─────────────────────────────────────────────────

test('/pay/choose: "Submit" is light grey and disabled until a receipt is attached, then green with white text', () => {
  assert.equal(SUBMIT_LABEL, 'Submit')
  assert.match(submitButtonClass(false), /bg-gray-200/)
  assert.doesNotMatch(submitButtonClass(false), /green/)
  assert.match(submitButtonClass(true), /bg-tm-green-deep/)
  assert.match(submitButtonClass(true), /text-white/)
  const bank = { bankName: 'Example Bank', accountTitle: 'Example Ltd', accountNumber: '0000111122223333', iban: 'PK00EXMP0000111122223333', raastId: null }
  const html = render(createElement(PayChoice, { planCode: 'verified', isFee: true, amount: 'Rs 100', bank, receipt: { state: 'none' } }))
  assert.match(html, /<button[^>]*disabled=""[^>]*data-submit-receipt="waiting"[^>]*bg-gray-200[^>]*>Submit<\/button>/)
  assert.ok(!html.includes('Send receipt'))
  // The contrast pairs are registered.
  const cc = read('scripts/contrast-check.ts')
  assert.match(cc, /\/pay\/choose Submit before a receipt is attached/)
  assert.match(cc, /\/pay\/choose Submit once a receipt is attached/)
})

test('/pay/choose: the "WhatsApp us" button is gone (every state)', () => {
  const bank = { bankName: 'Example Bank', accountTitle: 'Example Ltd', accountNumber: '0000111122223333', iban: 'PK00EXMP0000111122223333', raastId: null }
  for (const receipt of [{ state: 'none' }, { state: 'under_review' }] as const) {
    const html = render(createElement(PayChoice, { planCode: 'verified', isFee: true, amount: 'Rs 100', bank, receipt: receipt as never }))
    assert.ok(!html.includes('WhatsApp us'))
    assert.ok(!html.includes('data-whatsapp-button'))
    assert.ok(!html.includes('/whatsapp.png'))
  }
  assert.doesNotMatch(read('app/(site)/pay/choose/page.tsx'), /waHref/)
})

// ── Part D — tutor addresses in the review list ──────────────────────────

test('address review: tutor accounts are in the list, with the same Approve/Reject and status chip', () => {
  const docs = read('lib/parentDocuments.ts')
  assert.match(docs, /export async function tutorAddressesAwaitingReview\(\)/)
  assert.match(docs, /\.eq\('role', 'tutor'\)\s+\.or\(ADDRESS_WAITING_OR\)/)
  assert.match(docs, /loadParentDocs\(parentId, \{ allowTutor: item === 'address' \}\)/)
  assert.match(docs, /const verified = !isTutorAccount && !!after\?\.verified/, 'a tutor is never made a "verified parent"')
  // A typed, undecided address (no status yet) counts as waiting for parents too.
  assert.match(docs, /and\(address_verified_at\.is\.null,address_status\.is\.null,address\.not\.is\.null\)/)
  assert.match(read('lib/approvalQueue.ts'), /tutorAddressesAwaitingReview\(\)/)
  const html = render(
    createElement(ParentDocumentReview, {
      addressOnly: true,
      canReview: true,
      docs: {
        parentId: 't1', cnicFrontId: null, cnicBackId: null, cnicNumber: null, address: 'House 1, Street 2, DHA', city: 'Lahore',
        cnic: { status: 'none', reason: null, hasUpload: false }, addressItem: { status: 'pending', reason: null, hasUpload: true },
        verified: false, whatsapp: null,
      },
    }),
    { canApprove: true },
  )
  assert.ok(html.includes('Home address'))
  assert.ok(html.includes('Waiting for review'))
  assert.ok(html.includes('House 1, Street 2, DHA'))
  assert.ok(!html.includes('CNIC (front &amp; back)'), 'address only for a tutor')
  assert.match(read('app/admin/users/[id]/page.tsx'), /<ParentDocumentReview\s+addressOnly/)
})

// ── no phone numbers in logs ─────────────────────────────────────────────

test('logs: no new code prints or audits a phone number', () => {
  const files = [
    'lib/tuitionConsent.ts',
    'lib/tuitionConsentCore.ts',
    'lib/teamPosterCore.ts',
    'lib/reportCardCore.ts',
    'app/api/admin/jobs/consent/route.ts',
    'app/api/admin/jobs/consent/ask/route.ts',
    'app/api/admin/settings/hide-numbers/route.ts',
    'app/api/reports/route.ts',
    'lib/contactReveal.ts',
    'lib/parentDocuments.ts',
  ]
  for (const f of files) {
    const src = read(f)
    for (const line of src.split('\n')) {
      if (/console\.(log|info|warn|error)\(/.test(line)) {
        assert.doesNotMatch(line, /\b(phone\w*|msisdn|whatsapp|mobile|cnic\w*|contact_\w+)\b/i, `${f}: ${line.trim()}`)
      }
    }
  }
  // The consent audit rows carry the method and counts only.
  const tc = read('lib/tuitionConsent.ts')
  for (const m of tc.matchAll(/detail: \{([^}]*)\}/g)) assert.doesNotMatch(m[1], /msisdn|phone|whatsapp|href/i)
  const ask = read('app/api/admin/jobs/consent/ask/route.ts')
  assert.match(ask, /detail: \{ channel: 'whatsapp' \}/)
})
